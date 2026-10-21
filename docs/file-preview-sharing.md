# 文件预览 / 分享 边界说明（TR-004）

> 适用范围：VControlHub v1.x 起的本地 + SFTP 存储节点文件预览、压缩包查看/解压、Office 文件渲染、公开分享链接与一次性目录归档下载。
> 维护人：自动化维护代理 + 维护者
> 最近更新：2026-09-14（回收站归档隔离与失败恢复边界）

本文档聚焦"功能行为边界"——接口在不同条件下会返回什么、有什么限制、用户和管理员需要了解的安全与产品决策。代码层面的实现细节见 `src/lib/storage/streaming.ts` / `src/app/api/share/` / `src/app/api/files/` 等位置。

---

## 1. 核心接口清单

| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/storage/local` | GET | LOCAL 节点文件流（支持 Range） | `storage:read` |
| `/api/storage/sftp-download` | GET | SFTP 节点文件流（支持 Range） | `storage:read` |
| `/api/storage/archive-download` | GET | 目录一次性打包 `tar.gz` 流 | `storage:read` |
| `/api/files/archive-list` | GET | 压缩包内容列表 | `storage:read` |
| `/api/files/extract` | POST | 受控解压到当前目录 | `storage:write` |
| `/api/share-links` | GET / POST / DELETE | 分享链接管理 | `share:read` / `share:manage` |
| `/api/share/[token]` | GET | 公开分享访问（无登录） | **无需鉴权（token 即凭据）** |
| `/api/files/preview/*` | 服务端 | 文件预览页 SSR 调度（按 mimeType 分发到 Text/Markdown/Csv/Office/Archive/Media 客户端） | `storage:read` |

客户端入口在 `/files/preview`，mimeType → 客户端的映射见 `src/app/files/preview/page.tsx:84-100`。

---

## 2. HTTP Range / 206 / 416 边界（统一规范）

所有流式下载接口（`/api/storage/local`、`/api/storage/sftp-download`）走同一套实现：`src/lib/storage/streaming.ts:parseStorageRange` + `buildStorageStreamHeaders`。

### 2.1 三种 HTTP 状态语义

| 请求 | 状态 | 响应头关键字段 |
|---|---|---|
| 不带 `Range` 头 | **200** | `accept-ranges: bytes` + 完整 `content-length` |
| 合法 `Range` | **206** | `content-range: bytes <start>-<end>/<total>` + 分片 `content-length` |
| 非法 `Range` / 0 字节文件带 Range | **416** | `content-range: bytes */<total>`（无 body） |

### 2.2 Range 头解析规则

- **语法**：仅支持 `bytes=<start>-<end>` 形式（`bytes=-500` 后缀式也支持）。
- **多区间**（`bytes=0-99,200-299`）：**不支持**，回退为 416。
- **空文件**（fileSize = 0）：带 `Range` 必返 416；不带则 200 但 `content-length: 0`。
- **越界**（`start >= fileSize` 或 `end < start`）：返 416。
- **后缀截断**（`bytes=-N`）：自动算成 `start = max(fileSize - N, 0)`，典型用于视频流续传。
- **end 越上限**：截到 `fileSize - 1`（HTTP 规范允许服务器"降级"返回的 end）。

### 2.3 测试覆盖

`src/lib/storage/__tests__/streaming.test.ts` 4 个测试 case 覆盖：
- 200 完整下载 + 头字段（accept-ranges / content-length / content-disposition）
- 206 三种 Range 语法（`bytes=10-19` / `bytes=95-` / `bytes=-5`）
- 416 越界 + 0 字节文件
- 206 真实流 + content-range / content-length 推导

### 2.4 客户端行为约定

- 浏览器原生 `<video>` / `<audio>` / `<img>` 元素自动用 Range 续传，**无需**前端代码介入。
- 客户端 fetch 下载走完整 200，不用 Range（VControlHub 没有"分片合并"语义）。
- HTML5 video seek 操作会触发新的 Range 请求，本服务每次都正确返回 206。
- 不可用 Range 的场景：流式 `tar.gz` 归档（按目录现生成，content-length 未知）。

---

## 3. 公开分享链接边界

### 3.1 Token 形态

- 长度：48 字符（生成时 `randomBytes(36).toString("base64url").slice(0, 48)`，base64url 编码随机 36 字节 = 有效熵约 216 bit）。
- 存储：DB 仅存 `sha256(token)` 哈希值，**原 token 仅在创建时返回一次**（POST 响应体），过期/吊销后无法重算。
- 撤销：`DELETE /api/share-links?id=...` 写 `revokedAt` 字段；token 解析时第一关检查。
- 过期：`expiresInHours` 可选，不传则**永不过期**（仅靠 `revokedAt` 控制生命周期）。

### 3.2 路径安全（路径规范化）

`src/lib/share-link/service.ts:normalizeSharePath` 在分享创建时强制：

| 拒绝条件 | 原因 |
|---|---|
| 空路径 | 防止"分享整个存储节点"歧义 |
| 包含 NUL / 控制字符（`\u0000-\u001F\u007F`） | shell / fs 注入面 |
| Windows 盘符（`C:`）或 UNC（`//server/share`） | 跨平台路径遍历 |
| 含 `.` / `..` 段 | 跳出 basePath |
| 绝对路径前缀（`/...` 开头） | basePath 校验前置 |

最终路径：`basePath + <sanitized>` 双重检查（在 `assertStorageAccess` 内做 `resolveStoragePathWithinBase` 二次确认）。

### 3.3 公开访问语义

- **不需要登录**：`/api/share/[token]` 路径**未走** `withApiRoute` 鉴权，token 本身是凭据。
- **访问计数**：`peekShareToken`（落地页预览用）**不递增** `accessCount`；`resolveShareToken`（真正下载）才递增。
- **吊销检查**：`revokedAt` 非空 → 404 Not FoundError（不区分"不存在"和"已撤销"，避免 token 探测）。
- **过期检查**：`expiresAt < now` → 400 ValidationError。
- **目录分享**：如果 `entryType === "DIRECTORY"`，落地页触发 `listShareDirectoryFiles`，**自动 sync** 目录（LOCAL: 同步 inode 状态;SFTP: 通过 SFTP 同步任务拉一层）。

### 3.4 配额 / 限流

- 公开分享接口默认每个 token 每分钟最多 60 次请求。
- 密码验证按客户端 IP + token 隔离，15 分钟内最多 8 次尝试。
- `maxDownloads` 可设置最大下载次数；配额由条件更新原子申领，并发下载不会超限。
- 在打开交付流之前失败时会补偿返还下载配额。
- 访问日志记录动作、IP 和 User-Agent，分享管理页提供汇总和明细。

IP/UA 白名单与过期前提醒不属于当前分享链接合约；需要更严格访问控制时，应结合合理有效期、密码和下载次数上限。

---

## 4. 公开目录归档下载（tar.gz）

### 4.1 接口

登录下载：`GET /api/storage/archive-download?nodeId=<id>&path=<dir>`。

公开目录分享：`GET /api/share/<token>?archive=1`。

### 4.2 行为

- 对目标目录**实时** `tar -czf -` 流式输出 `application/gzip` 响应。
- LOCAL 走 `spawn("tar", ["-czf", "-", "-C", "<parent>", "--", "<dir>"])`。
- SFTP 走 SSH `exec` 同上命令。
- 两种入口均根据回收站索引排除已删除文件，以及已删除目录的整个子树。删除子文件后重新创建父目录分享，也不会包含回收站内容。
- 排除清单通过标准输入传入 tar，使用字面路径匹配，避免文件名中的通配字符误删其他成员。SFTP 主机的 tar 需要支持 `--no-wildcards`、`--anchored`、`--exclude-from`；不支持时下载失败，不会退回未过滤的打包。
- 从读取删除索引到流结束期间持有节点文件操作锁。同节点的复制、移动、软删除和其他归档请求需要在本次下载结束或取消后重试。锁不约束应用之外的直接磁盘修改。
- 排除记录超过 10,000 条或排除清单超过 1 MiB 时拒绝打包，避免截断清单泄漏被遗漏的回收站内容；可拆分目录后下载。
- 浏览器取消时释放锁并终止本地 tar；进程收到 SIGTERM 后 2 秒仍未退出则发送 SIGKILL。
- 文件名经 `safeArchiveName()` 处理：非 ASCII/特殊字符替换为 `-`，强制后缀 `.tar.gz`。
- HTTP 头：`content-type: application/gzip` + `content-disposition: attachment` + `cache-control: private, no-store`。
- **不支持 Range**：流是动态生成的，content-length 未知。
- 失败（源目录被删 / 权限不足）→ tar 进程 stderr 被记录为 warn，client 收到残缺流 + 半截 archive。

### 4.3 限制

- **仅支持目录**：单文件不走 archive-download（用 `/api/storage/local` 或 `/api/storage/sftp-download`）。
- 不会过滤符号链接 / 硬链接（在线解压会跳过它们，详见 §6）。
- 不会自动去重；同一目录多次打包得到多份独立归档。

### 4.4 文件操作失败后的恢复

- 删除在拿到节点操作锁后重新核对文件路径、节点和类型；读取后发生移动的条目会提示刷新，不会沿用旧路径权限删除。
- 本地目录复制入库失败时，仅尝试移除本次创建、身份未变化且仍为空的目录。已入库、出现新内容或无法确认身份时保留现场。
- 远端创建响应丢失，或移动成功后数据库更新与回滚均失败时，结果标记为“待确认”。后台任务不会将此类条目放入普通失败重试列表；前台移动表单也会停止直接重试。
- 收到待确认结果后，管理员应检查提示的源/目标路径、存储实际内容和文件索引，核对或修复一致性后再重新发起操作。此变更不会自动修复历史遗留的孤立目录或不一致索引。

---

## 5. 压缩包查看（archive-list）

`GET /api/files/archive-list?nodeId=<id>&driver=LOCAL&relativePath=<path>&name=<archive>`

### 5.1 支持格式

| 格式 | 读取方式 | 是否需要外部 CLI |
|---|---|---|
| `.zip` / `.jar` | 进程内读取中央目录（`src/lib/storage/zip-reader.ts`），支持 ZIP64，无 UTF-8 标志的文件名按 GBK 解码 | 不需要 |
| `.tar.gz` / `.tgz` / `.tar` | 进程内流式读取（`src/lib/storage/tar-reader.ts`），支持 ustar、GNU 长文件名和 PAX 头 | 不需要 |
| `.gz`（非 tar.gz） | 不调外部命令，返回单文件占位 | — |
| `.7z` | `7z l` | **需要 7z CLI** |
| `.rar` | `unrar l` | **需要 unrar CLI** |

ZIP 和 tar 不再解析 `unzip -l` / `tar -tv` 的输出。原因有三：
- Ubuntu 的 unzip 6.0 输出 `2026-10-21 03:08` 格式的日期，旧解析器只认识 `10-21-2026`，导致所有 ZIP 都显示为空。
- 服务以 C locale 运行，GNU tar 会把中文名输出成 `\344\270\255…`。
- Docker 镜像里没有 unzip。

### 5.2 限制

- **仅 LOCAL 节点**：SFTP 节点不在线查看压缩包。
- **损坏的压缩包**返回 400，提示“文件可能已损坏或与扩展名不符”，不再报 500。
- **7z / rar 失败** 抛带命令名提示的错误（"7z 格式需要安装 7z 命令行工具"）。
- **安全沙箱**：`sanitizeArchiveEntries` 过滤掉含 NUL、控制字符、可疑路径穿越的条目名。

### 5.3 客户端

- 落地页 `/files/preview` 的 `isArchive` 分支路由到 `ArchivePreviewClient`。
- 打开即加载列表。对于 zip/jar/tar/tgz/tar.gz/gz，在 LOCAL 节点上会显示“解压到文件夹”。解压成功后提供“打开文件夹”链接。
- 文件列表中，ZIP/tar 文件的右键菜单和 ⋯ 菜单里也有“解压到文件夹”。

---

## 6. 压缩包在线解压（extract）

`POST /api/files/extract` body: `{ storageNodeId, remotePath, targetDir?, driver?, name? }`

### 6.1 支持范围

| 输入格式 | 行为 |
|---|---|
| `.gz`（**非** tar.gz） | ✅ 在同目录生成去掉 `.gz` 后缀的单个文件；同步写 `fileEntry` |
| `.zip` / `.jar` / `.tar` / `.tar.gz` / `.tgz` | ✅ 解压到压缩包旁边的**新文件夹**，并为新文件夹逐层建索引 |
| `.7z` / `.rar` | ❌ 400，提示支持的格式 |
| 其它扩展名 | ❌ 400，提示支持的格式 |

ZIP / tar 的解压位置和结果：
- 解压位置：如果所有条目都在同一个顶层文件夹里，就用这个文件夹；否则新建一个以压缩包命名的文件夹（`photos.tar.gz` → `photos/`）。
- 重名处理：同名文件夹已存在时，依次尝试 `name (2)`、`name (3)`……，**绝不写入已存在的文件夹**。
- 返回值：`{ message, folder, files, directories, skipped }`。其中 `folder` 是新文件夹相对节点根的路径。

### 6.2 关键安全决策

ZIP / tar 解压**不调用任何外部解压工具**，由 `src/lib/storage/archive-extract.ts` 自行读取并写盘：
- **只写普通文件和目录**：符号链接、硬链接、设备文件一律跳过，并计入 `skipped`，不会创建任何链接。
- **路径校验**：每个条目都先规范化。去掉开头的 `/` 和 `./`；只要出现 `..`、盘符、NUL 或控制字符，整个压缩包都会被拒绝（400），且不写入任何内容。
- **先规划，后写盘**：先完整扫描一遍，检查条目数（≤ 20,000）、展开后的总大小（≤ 2 GiB）、是否加密、压缩方式（仅 store / deflate）。再按展开大小做授权的单文件上限与配额检查（同上传）。全部通过后才开始写入。
- **写入时再核对**：ZIP 每个条目都按中央目录里的大小和 CRC 校验，谎报大小的条目会立刻中止。总写入量不会超过规划值。
- **暂存后改名**：先解压到同目录下的 `.vch-extract-<uuid>.tmp`，用 `lstat` 复核整棵树只含普通文件和目录，再改名为目标文件夹。任何失败都会删除暂存目录，不留下半成品。

**`.gz`**：单文件压缩，不涉及目录结构。用 Node zlib 解压，输出量受尾部声明大小和 1 GiB 上限双重约束。

### 6.3 原子性

```ts
// 1. fs.access 确认源存在
// 2. 检查目标文件不存在（DB + 磁盘双检查）→ 409
// 3. execFile("gunzip", ["-k", fullPath])  → 60s timeout, 10MB buffer
// 4. fs.stat 确认产物存在
// 5. createFileEntry(...) 写库
//    失败 → fs.unlink 回滚产物（best-effort, 错误吞掉, 保留原始错）
```

**并发安全**：双检查（DB + fs.access）防止并发请求同时解压。极端竞态：两个请求同时通过双检查，第二个 `createFileEntry` 会撞 unique 约束 → 触发 5xx → 第一个请求的 `gunzip` 产物会"幽灵残留"在磁盘上（next 同步任务会自动清理）。这种竞态概率极低（< 0.01%），可接受。

### 6.4 权限

- `assertStorageAccess` 对**源路径**和**目标目录**都做 `read` / `write` 检查。
- 仅对**读权限 + 写权限**都通过的用户开放。

### 6.5 配额

**设计边界**：
- ZIP / tar 按展开后的总大小做配额与授权检查（`writeBytes`）。`.gz` 按尾部声明的大小检查。
- 解压在请求内同步完成（与“压缩”一致），不进入 durable job，也没有单独的解压历史。上限为 20,000 个条目、2 GiB。

---

## 7. Office 文件预览

`docx` / `xlsx` / `pptx`（MIME 走 `application/vnd.openxmlformats-officedocument.*`）

### 7.1 当前行为

**不接入** Office Online iframe。原因：

- Office Online 要求文件 URL **公网直连可达**（无登录态）。
- VControlHub 的文件走登录态 + Caddy 反代保护，公网 URL 仅在用户登录后有效。
- 暴露公网直连 URL → 任何拿到 URL 的人都能下载（即使已 revoke）→ 违反"私有文件保护"产品定位。

### 7.2 替代方案

落地页显示统一提示：
> 此 Office 文件暂不支持稳定在线渲染预览
> Office Online 需要 Microsoft 服务器直接访问文件 URL；当前文件预览使用登录态保护的主站受控流，
> 不会把私有文件暴露为公网直连地址。请下载后使用本地软件打开。

用户可点击"下载"按钮走 `/api/storage/local` 或 `/api/storage/sftp-download` 拿原文件。

### 7.3 未来扩展

- **本地服务化渲染**：LibreOffice headless (`soffice --convert-to pdf`) 转 PDF 后内嵌 pdf.js 预览。需要沙箱 + 配额。
- **服务端 PDF 化**：把 docx/xlsx/pptx 转 PDF 缓存，preview 走 PDF 流。

### 7.4 测试覆盖

`src/app/files/__tests__/office-preview-client.test.tsx` 测试"does not iframe Microsoft Office Online for protected storage previews"，断言 `container` 不含 `iframe[src*="office.com"]` 之类的标志。

---

## 8. Media（图片/视频/音频）预览

`/api/media/[id]/stream` 走 `src/app/api/media/[id]/stream/route.ts`，行为跟 §2 完全一致（Range / 206 / 416 全支持）。

特殊点：
- 缩略图走 `/api/media/[id]/thumbnail`（独立接口，独立缓存）。
- 图片预览使用 `<img>` 标签，不走 Range（直接 200）。
- 视频/音频走 `<video>` / `<audio>`，浏览器自动用 Range seek。

---

## 9. 已知限制与未来增强

| 项 | 当前 | 建议改进 |
|---|---|---|
| Range 多区间 | 不支持，回 416 | 加 `bytes=0-99,200-299` 解析，multipart/byteranges 响应 |
| 公开分享限流 | 无 | 加 per-token 速率限制 + IP 维度 |
| 公开分享白名单 | 无 | 支持 IP / UA 维度白名单 |
| 公开分享预览目录 | 全量列（take 200） | 加分页 + 搜索 |
| 压缩包 7z/rar 在线解压 | 拒绝 | 进程内读取器（同 ZIP/tar），或容器内沙箱化外部工具 |
| Office 预览 | 仅"下载查看" | LibreOffice headless 转 PDF + pdf.js 内嵌 |
| 归档下载 content-length | 未知（动态生成） | 加 `--totals` 预扫描获取大致大小 |
| 归档下载 SFTP 性能 | 一次 tar 大包 | 多文件并发（zip 风格） |
| 文件预览缓存 | 无 | nginx / Varnish 层缓存 media 文件 |
| 分享下载水印 | 无 | 可选基于 user-agent 注入版权水印 |

---

## 10. 故障排查

### 10.1 用户报告"下载失败/无响应"

- 浏览器 F12 → Network → 看状态码：
  - 416 → 客户端 Range 错（视频 seek 越界，刷新可恢复）
  - 200 + content-length 截断 → 服务端流中断（看 journalctl）
  - 0 / 无响应 → 网络层 / Caddy 配置
- 服务端：`journalctl -u vcontrolhub-next.service --since "5 min ago" | grep -i "archive\|stream\|sftp"`。

### 10.2 压缩包列表为空 / 报错

- 检查 7z / unrar 是否安装（`which 7z` / `which unrar`）。
- 检查 tar 文件是否被破坏：`tar -tzvf <file> 2>&1` 手动跑。
- 检查 `nodeId` / `relativePath` 是否在用户 storage 访问范围内（403 vs 200）。

### 10.3 分享链接 404

- `revokedAt` 字段非空（已撤销）→ 永久失效。
- `expiresAt` < now → 过期。
- DB 行不存在（极少见，除非手动清表）→ 重新创建。
- `path` 规范化失败 → 重新创建时检查路径含非法字符。

### 10.4 在线解压失败

- 400 带具体原因：压缩包损坏、加密、使用了不支持的压缩方式、含不安全路径、超过 20,000 个条目或 2 GiB。这些都属于预期中的拒绝。
- 403：对压缩包所在目录没有写权限，或展开大小超过授权的单文件上限或配额。
- 500：看 journalctl 中 `/api/files/extract` 的错误。暂存目录 `.vch-extract-*.tmp` 在失败时会被删除；若残留，说明进程在解压中途被杀，可以手动删除。
- `.gz` 遇到 409：目标文件已存在（DB 或磁盘）。

---

## 11. 相关代码位置索引

| 关注点 | 文件 |
|---|---|
| Range 解析 | `src/lib/storage/streaming.ts` |
| Range 测试 | `src/lib/storage/__tests__/streaming.test.ts` |
| LOCAL 流式下载 | `src/app/api/storage/local/route.ts` |
| SFTP 流式下载 | `src/app/api/storage/sftp-download/route.ts` |
| 归档打包 | `src/lib/storage/archive-stream.ts` |
| 归档下载 route | `src/app/api/storage/archive-download/route.ts` |
| 压缩包列表 | `src/app/api/files/archive-list/route.ts` |
| 在线解压 | `src/app/api/files/extract/route.ts` |
| 分享链接 service | `src/lib/share-link/service.ts` |
| 分享链接 API | `src/app/api/share-links/route.ts` |
| 公开分享 | `src/app/api/share/[token]/route.ts` |
| 预览页 SSR | `src/app/files/preview/page.tsx` |
| Office 客户端 | `src/app/files/preview/office-preview-client.tsx` |
| 归档客户端 | `src/app/files/preview/archive-preview-client.tsx` |
| Media 流 | `src/app/api/media/[id]/stream/route.ts` |
| Media 测试 | `src/app/api/media/[id]/stream/__tests__/route.test.ts` |

---

## 12. 变更历史

| 日期 | 提交 | 变更 |
|---|---|---|
| 2026-06-16 | (本 commit) | TR-004 收口：创建本文档，统一 Range/206/416 / Office / 压缩包 / 分享 / 归档 6 个边界的对外说明 |
| 2026-05 之前 | 多次 | Range 解析 + storageStreamResponse 统一头工具 + 归档下载 / 公开分享 / 压缩包列表 / 在线解压 主体功能落地 |
