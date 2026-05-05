# 文件管理增强（成熟网盘体验）实施计划

> **For Hermes:** Use subagent-driven-development / strict TDD to implement this plan task-by-task.

**Goal:** 把现有 `/files` 独立文件管理页升级成更接近成熟网盘的生产级文件中心，一次性补齐上传、目录操作、媒体预览优化、远端节点真实文件树接入。

**Architecture:** 保持 `/storage` 负责“节点配置 + 上传入口”的职责边界不变，把日常文件操作集中沉淀到 `/files`。后端优先复用现有 `storage service`、`/api/storage/local`、`storage actions`，新增面向目录管理与远端浏览的 server actions / route；前端采用“左侧目录树 + 顶部操作栏 + 中央列表 + 右侧预览/详情”的成熟云盘交互。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Vitest、Prisma 7、现有 Tailwind 样式体系。

---

## 一、现状盘点结论

### 已有能力
- `/files` 已有：
  - 目录树
  - 面包屑
  - 文件/目录列表
  - 下载入口
  - 基础预览入口
  - 本机文本文件在线编辑卡片
- `/storage` 已有：
  - LOCAL 节点上传卡片 `src/app/storage/storage-local-upload-card.tsx`
  - 存储节点创建表单
- 后端已有：
  - `GET /api/storage/local?path=...`：本机文件受控下载/内联预览
  - `POST /api/storage/local`：上传到 LOCAL 节点并自动登记/更新 `fileEntry`
  - `createFileEntry` / `updateFileEntry` / `softDeleteFileEntry`
  - `getStorageOverview()`：聚合节点、条目、统计
- 远端节点已有：
  - 数据模型支持 `SFTP`
  - `directAccess` 已能生成 `sftp://...` 直连描述

### 明确缺口
- `/files` 顶部没有成熟网盘式操作栏（上传 / 新建文件夹 / 当前目录说明 / 视图辅助）
- 没有目录的新建、重命名、删除交互
- 现有媒体预览只是裸链接，没有统一预览面板/播放器/详情区
- 远端节点“真实文件树”尚未接入，当前更多依赖已登记条目，而不是主动读取远端层级
- 现有上传能力停留在 `/storage`，没有沉淀到 `/files`
- 目录操作当前只覆盖数据库条目，不覆盖本地文件系统目录、也未为 SFTP 提供后端浏览/操作入口

---

## 二、产品方案（参考成熟网盘体验）

参考方向：
- **Linear / Raycast 风格**：深色、克制、高信息密度、层级清晰
- **Dropbox / Google Drive / 阿里云盘类交互**：
  - 当前目录操作集中在顶部工具条
  - 列表内提供轻量操作
  - 右侧或弹层提供媒体预览与详情
  - 文件来源节点、访问方式、预览能力有清晰标识

### 页面布局升级
1. **左栏：目录树 + 节点筛选**
   - 保留现有目录树
   - 增加“全部节点 / LOCAL / SFTP / 指定节点”过滤
   - 当前目录高亮更明显
2. **顶部操作栏**
   - 上传按钮
   - 新建文件夹
   - 当前目录说明
   - 当前节点/来源标签
3. **主列表区**
   - 文件夹优先
   - 行内操作：打开 / 下载 / 预览 / 更多
   - 媒体、文档、普通文件使用不同图标/标签
4. **预览区（首版可做嵌入式卡片，不强求复杂抽屉）**
   - 图片：`img`
   - 视频：`video controls`
   - 音频：`audio controls`
   - 其他：显示“仅支持下载/外部打开”

---

## 三、实施任务拆分

## Phase A：先补测试（RED）

### Task A1：为 `/files` 新操作栏写失败测试
**Objective:** 锁定成熟网盘式顶部工具条的基本结构。

**Files:**
- Modify: `src/app/files/__tests__/page.test.tsx`

**Step 1: Write failing test**
- 断言存在：
  - “上传文件”按钮/区域
  - “新建文件夹”按钮
  - 当前目录标签
  - 节点来源/筛选文案（首版至少要有来源说明）

**Step 2: Run test to verify failure**
Run:
```bash
npm test -- --run src/app/files/__tests__/page.test.tsx
```
Expected: FAIL

**Step 3: Commit**
```bash
git add src/app/files/__tests__/page.test.tsx
git commit -m "test: cover files page action toolbar"
```

### Task A2：为目录操作写失败测试
**Objective:** 锁定新建目录、目录重命名、目录删除入口。

**Files:**
- Modify: `src/app/files/__tests__/page.test.tsx`
- May create: `src/lib/storage/__tests__/directory-actions.test.ts`

**Step 1: Write failing test**
- 对 UI：断言目录行/当前目录出现“重命名”“删除”“新建文件夹”文案
- 对 service：为目录路径变更、删除保护写单测

**Step 2: Run test to verify failure**
```bash
npm test -- --run src/app/files/__tests__/page.test.tsx src/lib/storage/__tests__/directory-actions.test.ts
```
Expected: FAIL

### Task A3：为媒体预览卡片写失败测试
**Objective:** 锁定统一预览区，而非仅一个“预览”链接。

**Files:**
- Modify: `src/app/files/__tests__/page.test.tsx`

**Step 1: Write failing test**
- 断言图片/视频/音频文件行附近或页面下方存在“预览面板/媒体预览/在线播放”文案
- 对视频条目断言有更明确的媒体信息展示（如 MIME/节点/访问方式）

**Step 2: Run test to verify failure**
```bash
npm test -- --run src/app/files/__tests__/page.test.tsx
```
Expected: FAIL

### Task A4：为远端真实文件树聚合写失败测试
**Objective:** 锁定“页面可展示远端目录树数据”这一能力。

**Files:**
- Create: `src/lib/storage/__tests__/remote-tree.test.ts`
- Modify: `src/app/files/__tests__/page.test.tsx`

**Step 1: Write failing test**
- service 级测试：给一个 SFTP 节点 mock，期望返回远端目录树/远端条目摘要
- page 级测试：断言远端节点目录可出现在目录树或列表来源标签中

**Step 2: Run test to verify failure**
```bash
npm test -- --run src/lib/storage/__tests__/remote-tree.test.ts src/app/files/__tests__/page.test.tsx
```
Expected: FAIL

---

## Phase B：提炼共用路径/目录能力

### Task B1：抽出通用相对路径工具
**Objective:** 避免 `/files/page.tsx` 与 `storage-local-upload-card.tsx` 各自维护路径规范逻辑。

**Files:**
- Create: `src/lib/storage/path.ts`
- Modify: `src/app/files/page.tsx`
- Modify: `src/app/storage/storage-local-upload-card.tsx`
- Test: `src/lib/storage/__tests__/path.test.ts`

**Implementation Notes:**
导出：
- `normalizeRelativePath(input)`
- `splitRelativePath(path)`
- `joinRelativePath(...segments)`
- `getParentRelativePath(path)`

### Task B2：为目录条目聚合增加 helper
**Objective:** 统一“当前目录展示项”计算，便于把本地条目与未来远端树混合渲染。

**Files:**
- Create: `src/lib/storage/tree.ts`
- Modify: `src/app/files/page.tsx`
- Test: `src/lib/storage/__tests__/tree.test.ts`

---

## Phase C：实现 LOCAL 目录操作

### Task C1：新增 LOCAL 目录管理 API
**Objective:** 支持本机目录的新建、重命名、删除。

**Files:**
- Create: `src/app/api/storage/local/directory/route.ts`
- Possibly create: `src/lib/storage/local-directory.ts`
- Test: `src/lib/storage/__tests__/local-directory.test.ts`

**API shape（建议）**
- `POST`：`{ storageNodeId, parentPath, name }` -> 新建目录
- `PATCH`：`{ storageNodeId, path, nextName }` -> 重命名目录
- `DELETE`：`{ storageNodeId, path }` -> 删除空目录；非空目录时返回明确错误

**Important:**
- 使用与现有 `/api/storage/local` 相同的安全路径校验策略
- 目录创建/重命名/删除后，同步维护 `fileEntry` 中 DIRECTORY 条目与受影响子项路径

### Task C2：在 service 层补目录元数据同步
**Objective:** 避免只改磁盘不改数据库，或者只改数据库不改磁盘。

**Files:**
- Modify: `src/lib/storage/service.ts`
- Modify: `src/lib/storage/schema.ts`
- Test: `src/lib/storage/__tests__/directory-actions.test.ts`

**Need to add:**
- `createDirectoryEntry(...)`
- `renameDirectoryEntries(...)`
- `deleteDirectoryEntry(...)`
- 若目录重命名，批量更新该目录下所有子条目的 `relativePath`

---

## Phase D：把上传入口沉淀到 `/files`

### Task D1：抽出可复用上传组件
**Objective:** 让 `/storage` 与 `/files` 共用上传交互，而不是复制粘贴。

**Files:**
- Create: `src/components/storage/file-upload-dropzone.tsx`
- Modify: `src/app/storage/storage-local-upload-card.tsx`
- Modify: `src/app/files/page.tsx`（引入包装卡片或客户端子组件）
- Test: `src/app/files/__tests__/page.test.tsx`

**Implementation Notes:**
- 先保留只支持 LOCAL 上传
- 但文案上写清“远端节点即将/由真实文件树接管，不经控制机中转上传”之类提示不要加；避免未实现承诺
- 上传成功后返回当前目录刷新

### Task D2：让 `/files` 顶部工具栏支持“上传到当前目录”
**Objective:** 用户在浏览某个目录时可直接上传到该目录。

**Files:**
- Modify: `src/app/files/page.tsx`
- Possibly create: `src/app/files/files-toolbar.tsx`

**Behavior:**
- 当前目录为 `docs/manual` 时，上传默认目标目录就是该路径
- 仅在有 `storage:write` 时展示

---

## Phase E：实现成熟网盘式目录操作 UI

### Task E1：新增 `/files` 顶部工具栏
**Objective:** 形成成熟网盘的主要操作入口。

**Files:**
- Create: `src/app/files/files-toolbar.tsx`
- Modify: `src/app/files/page.tsx`
- Test: `src/app/files/__tests__/page.test.tsx`

**Toolbar contents:**
- 上传文件
- 新建文件夹
- 当前路径标签
- 项目数
- 节点/来源说明（至少展示当前目录内容涉及的节点）

### Task E2：目录行增加轻量操作
**Objective:** 用户无需跳转即可操作目录。

**Files:**
- Modify: `src/app/files/page.tsx`
- Possibly create: `src/app/files/folder-row-actions.tsx`

**Actions:**
- 打开目录
- 重命名
- 删除

**First version rule:**
- 删除仅允许空目录，降低复杂度与误删风险
- 非空目录给出明确提示

---

## Phase F：媒体预览体验升级

### Task F1：实现统一媒体预览卡片
**Objective:** 从“跳转式预览”提升为“页内预览”。

**Files:**
- Create: `src/app/files/file-preview-card.tsx`
- Modify: `src/app/files/page.tsx`
- Test: `src/app/files/__tests__/page.test.tsx`

**Behavior:**
- 图片：直接显示缩略/大图
- 视频：`<video controls preload="metadata">`
- 音频：`<audio controls>`
- 其他文件：显示“当前类型暂不支持页内预览，请下载”

### Task F2：文件列表增加类型徽标与来源说明
**Objective:** 提升成熟产品的可扫读性。

**Files:**
- Modify: `src/app/files/page.tsx`

**Add:**
- 媒体类型 badge
- 节点来源 badge
- LOCAL/SFTP 标记
- 直连/受控访问说明的简短文案

---

## Phase G：远端真实文件树接入（首版可先只读）

### Task G1：新增远端树读取 service
**Objective:** 能从 SFTP 节点读取真实目录结构，而不是只靠预登记条目。

**Files:**
- Create: `src/lib/storage/remote-tree.ts`
- Modify: `src/lib/storage/service.ts`
- Test: `src/lib/storage/__tests__/remote-tree.test.ts`

**Implementation strategy:**
- 先不要急着做完整远端写操作
- 首版目标：**只读目录树 + 文件元信息展示**
- 由于仓库当前未确认已有可直接使用的 ssh2/sftp 客户端封装，先按下面两层结构设计：
  1. `listRemoteTreeForNode(nodeId, path)`：抽象接口
  2. 若当前环境暂无稳定 SFTP 依赖，则先返回可扩展 stub / mockable provider，并把接线位置留好
- 如果仓库中后续找到已存在的远端执行通道，再接入真实实现

**Important:**
- 这一阶段重点是把 `/files` 数据模型与 UI 改造成“可接纳远端真实树”
- 不要为了首版把整套 SSH 基础设施重构掉

### Task G2：把远端树并入 `/files` 目录导航
**Objective:** 页面能显示来自 SFTP 节点的真实目录层级。

**Files:**
- Modify: `src/app/files/page.tsx`
- Possibly create: `src/app/files/storage-node-filter.tsx`

**Behavior:**
- 用户可以按节点查看目录树
- SFTP 节点下，显示“远端目录（只读）”标识
- 下载/预览仍优先走 `directAccess`

---

## Phase H：回归测试与构建验证

### Task H1：跑目标测试
**Run:**
```bash
npm test -- --run src/app/files/__tests__/page.test.tsx src/app/storage/__tests__/page.test.tsx src/lib/storage/__tests__/service.test.ts src/lib/storage/__tests__/directory-actions.test.ts src/lib/storage/__tests__/remote-tree.test.ts
```

### Task H2：类型检查
**Run:**
```bash
set -a && source ./.env.example && source ./.env.local && set +a && npx tsc -p tsconfig.json --noEmit --pretty false
```

### Task H3：生产构建
**Run:**
```bash
set -a && source ./.env.example && source ./.env.local && set +a && npm run build
```

---

## 四、实现优先级建议

按最稳妥的落地顺序：
1. **先做 `/files` 工具栏与上传沉淀**
2. **再做 LOCAL 目录操作（新建 / 重命名 / 删除）**
3. **再做媒体预览卡片升级**
4. **最后做远端真实文件树接入（先只读）**

原因：
- 这样最符合 TDD 和增量交付
- 前 3 项都可依托现有本机能力快速落地并验证
- 远端真实树是价值高但不确定性最大的部分，适合放在最后单独收口

---

## 五、关键约束与注意事项

- 保持 `/storage` 继续只负责“节点管理 + 上传入口”，不要把文件列表重新塞回去
- `/files` 不要出现 demo/test 文案
- 目录删除首版只做空目录删除，避免误删整棵树
- Prisma / build 验证必须先 source：
```bash
set -a && source ./.env.example && source ./.env.local && set +a && ...
```
- 避免重新依赖已证明会导致类型不兼容的窄字段假设
- 对 SFTP 首版应明确标注只读或能力边界，不要伪装成已支持完整远端写操作

---

## 六、完成定义（Definition of Done）

- `/files` 出现成熟网盘式顶部操作栏
- 可在 `/files` 当前目录直接上传文件
- 可在 `/files` 中新建文件夹
- 可对 LOCAL 目录执行重命名与空目录删除
- 图片 / 视频 / 音频拥有统一页内预览体验
- 页面结构能承接 SFTP 远端真实文件树，并至少支持首版只读展示
- 对应测试通过
- `tsc` 通过
- `next build` 通过
