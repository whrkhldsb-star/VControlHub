# VControlHub i18n Coverage Report

> Generated: 2026-06-16T19:10:10.978Z | Files: 261 | Strings: 769 | Coverage: **23.9%** (184/769)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/health` | 4 | 0 | 4 | 0% |
| `src/app/snippets` | 1 | 0 | 1 | 0% |
| `src/components/storage` | 6 | 0 | 6 | 0% |
| `src/app/deployments` | 44 | 2 | 42 | 4.5% |
| `src/components/ssh-terminal-modal.tsx` | 14 | 1 | 13 | 7.1% |
| `src/app/account` | 12 | 1 | 11 | 8.3% |
| `src/app/backups` | 46 | 4 | 42 | 8.7% |
| `src/app/qa-reports` | 10 | 1 | 9 | 10% |
| `src/app/downloads` | 38 | 4 | 34 | 10.5% |
| `src/app/requests` | 24 | 3 | 21 | 12.5% |
| `src/app/shares` | 14 | 2 | 12 | 14.3% |
| `src/app/quick-services` | 48 | 7 | 41 | 14.6% |
| `src/app/media` | 38 | 6 | 32 | 15.8% |
| `src/app/settings` | 31 | 5 | 26 | 16.1% |
| `src/app/servers` | 105 | 26 | 79 | 24.8% |
| `src/components/route-error.tsx` | 4 | 1 | 3 | 25% |
| `src/components/two-factor-settings.tsx` | 12 | 3 | 9 | 25% |
| `src/app/storage` | 46 | 13 | 33 | 28.3% |
| `src/app/files` | 139 | 44 | 95 | 31.7% |
| `src/app/login` | 3 | 1 | 2 | 33.3% |
| `src/app/operation-tasks` | 29 | 10 | 19 | 34.5% |
| `src/app/image-bed` | 22 | 8 | 14 | 36.4% |
| `src/app/scheduled-tasks` | 23 | 10 | 13 | 43.5% |
| `src/app/global-error.tsx` | 4 | 2 | 2 | 50% |
| `src/app/share` | 12 | 6 | 6 | 50% |
| `src/app/audit` | 28 | 15 | 13 | 53.6% |
| `src/components/change-password-modal.tsx` | 5 | 3 | 2 | 60% |
| `src/app/announcements` | 6 | 5 | 1 | 83.3% |
| `src/components/page-shell.tsx` | 1 | 1 | 0 | 100% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t("<key>")` or the `dom-bridge` data-i18n system.

| String | Count | First 3 occurrences |
|---|---|---|
| 修改时间 | 2 | `src/app/files/file-detail-panel.tsx:113` (text), `src/app/files/file-list-client.tsx:781` (text) |
| 列表视图 | 2 | `src/app/files/file-list-client.tsx:1110` (title), `src/app/files/file-list-client.tsx:1110` (aria-label) |
| 图标视图 | 2 | `src/app/files/file-list-client.tsx:1141` (title), `src/app/files/file-list-client.tsx:1141` (aria-label) |
| 详情视图 | 2 | `src/app/files/file-list-client.tsx:1170` (title), `src/app/files/file-list-client.tsx:1170` (aria-label) |
| 选择存储节点 | 2 | `src/app/files/files-browser-spa.tsx:235` (text), `src/app/image-bed/image-bed-page-client.tsx:590` (text) |
| 目录树 | 2 | `src/app/files/files-browser-spa.tsx:527` (aria-label), `src/app/files/files-browser-spa.tsx:536` (text) |
| 移动 | 2 | `src/app/files/move-inline-form.tsx:66` (title), `src/app/files/move-inline-form.tsx:90` (text) |
| 系统自检 | 2 | `src/app/files/page.tsx:232` (text), `src/components/route-error.tsx:58` (text) |
| 当前目录 | 2 | `src/app/files/page.tsx:262` (text), `src/app/files/search-scope-toggle.tsx:42` (text) |
| 回收站 | 2 | `src/app/files/page.tsx:270` (text), `src/app/files/page.tsx:304` (text) |
| 重命名 | 2 | `src/app/files/rename-inline-form.tsx:70` (title), `src/app/files/rename-inline-form.tsx:94` (text) |
| 共   条 | 2 | `src/app/operation-tasks/job-events-dialog.tsx:208` (text), `src/app/operation-tasks/operation-task-list-client.tsx:86` (text) |
| ← 返回报告列表 | 2 | `src/app/qa-reports/[id]/page.tsx:53` (text), `src/app/qa-reports/[id]/page.tsx:68` (text) |
| 原因： | 2 | `src/app/requests/page.tsx:93` (text), `src/app/scheduled-tasks/scheduled-task-list-client.tsx:174` (text) |
| 原因 / 备注 | 2 | `src/app/scheduled-tasks/scheduled-task-list-client.tsx:333` (text), `src/app/servers/command-create-form.tsx:60` (text) |
| 确认删除「 」？ | 2 | `src/app/servers/server-card-actions.tsx:350` (text), `src/app/storage/storage-node-delete-button.tsx:39` (text) |
| 当前运行值： | 2 | `src/app/settings/settings-client.tsx:795` (text), `src/app/settings/settings-client.tsx:881` (text) |
| 生效位置： | 2 | `src/app/settings/settings-client.tsx:798` (text), `src/app/settings/settings-client.tsx:884` (text) |
| 保存后需重启对应服务才会改变已启动进程。 | 2 | `src/app/settings/settings-client.tsx:804` (text), `src/app/settings/settings-client.tsx:890` (text) |
| 原值 | 2 | `src/app/settings/settings-client.tsx:1050` (text), `src/app/settings/settings-client.tsx:1138` (text) |
| 新值 | 2 | `src/app/settings/settings-client.tsx:1051` (text), `src/app/settings/settings-client.tsx:1142` (text) |
| 根目录 | 2 | `src/app/storage/storage-node-create-form.tsx:46` (text), `src/app/storage/storage-node-edit-form.tsx:62` (text) |
| 绑定 VPS | 2 | `src/app/storage/storage-node-create-form.tsx:52` (text), `src/app/storage/storage-node-edit-form.tsx:68` (text) |
| *（SFTP 必填绑定VPS或远端主机） | 2 | `src/app/storage/storage-node-create-form.tsx:52` (text), `src/app/storage/storage-node-edit-form.tsx:68` (text) |
| 不绑定 | 2 | `src/app/storage/storage-node-create-form.tsx:54` (text), `src/app/storage/storage-node-edit-form.tsx:70` (text) |

## Files with missing translations (most gaps first)

### `src/app/backups/page.tsx` — 30/30 missing (0%)

- L34 title title= "备份与迁移"
- L38 text "完成备份"
- L40 text "共   条记录"
- L43 text "已用备份空间"
- L45 text "最大：  · $ ` : "暂无"}"
- L48 text "保留策略提示"
- L50 text "条完成备份超过 30 天，建议复核清理"
- L53 text "异常/执行中"
- _…and 22 more_

### `src/app/settings/settings-client.tsx` — 26/30 missing (13.3%)

- L242 text "当前角色无系统设置权限"
- L253 text "✓ 设置已保存 ` : ""}"
- L259 aria-label aria-label= "设置分类导航"
- L262 text "⚙️ 设置分类"
- L263 text "点击下方分类快速跳转，或一键展开/折叠所有分组。常用项默认展开，运行参数等高级项默认折叠。"
- L270 text "全部展开"
- L277 text "全部折叠"
- L572 text "最近修改"
- _…and 18 more_

### `src/app/deployments/page.tsx` — 24/25 missing (4%)

- L40 text "💡 使用流程"
- L44 text "1. 创建模板"
- L45 text "在「命令模板」页面创建带"
- L49 text "2. 选择模板"
- L50 text "在下方选择你要部署的模板"
- L54 text "3. 填写变量"
- L55 text "填写模板所需的变量值（如版本号、端口等）"
- L59 text "4. 选择 VPS"
- _…and 16 more_

### `src/app/media/page.tsx` — 23/25 missing (8%)

- L90 text "🔗 外链中心"
- L94 text "当前视图   项"
- L98 aria-label aria-label= "媒体类型"
- L100 text "项媒体"
- L103 text "🖼️ 图片"
- L103 text "上传 / 发布外链"
- L106 text "🎬 视频"
- L106 text "播放 / 下载"
- _…and 15 more_

### `src/app/quick-services/quick-services-client.tsx` — 23/25 missing (8%)

- L264 text "当前角色无快捷服务管理权限"
- L338 text "Docker 环境未就绪，快捷服务安装已暂停"
- L349 text "查看任务中心"
- L367 text "运行概览"
- L368 text "个服务在线` : "还没有运行中的服务"}"
- L390 text "从推荐服务中安装 AList、Uptime Kuma 或 Portainer 后，这里会出现访问入口。"
- L395 text "个监听端口"
- L396 text "安装前会实时检查端口冲突，当前服务端口会优先显示在运行入口里。"
- _…and 15 more_

### `src/app/downloads/downloads-client.tsx` — 21/22 missing (4.5%)

- L292 text "全局下载速度"
- L296 text "活跃任务"
- L300 text "等待中"
- L304 text "全局限速"
- L311 text "需 manage-node 权限"
- L319 text "⬇   个下载中"
- L320 text "⏳   个等待中"
- L354 text "暂无可用下载目标：请先在 VPS 管理中为节点绑定存储并配置 SSH。"
- _…and 13 more_

### `src/app/files/files-browser-spa.tsx` — 20/27 missing (25.9%)

- L207 text "当前："
- L222 text "搜索存储节点"
- L225 placeholder placeholder= "节点名称、类型或 ID"
- L235 text "选择存储节点"
- L244 text "🌐 全部节点"
- L253 text "没有匹配的节点"
- L396 aria-label aria-label= "面包屑"
- L527 aria-label aria-label= "目录树"
- _…and 12 more_

### `src/app/servers/server-card-actions.tsx` — 16/24 missing (33.3%)

- L109 aria-label aria-label= "目标服务器直连网关控制"
- L121 text "直连状态："
- L134 text "当前上传、下载、在线浏览默认走网站中转。"
- L142 text "直连服务已声明启用。"
- L145 text "若文件预览/下载异常，请先确认目标 VPS 上 Direct Gateway
                    进程仍在监听  ，并检查防火墙是否放行该端口；切回网站中转会先尝试卸载远端服务，成功后再更新数据库状态。"
- L152 text "启用前检查：VPS 必须绑定 SFTP 存储节点且不是本机地址。"
- L155 text "点击启用会通过 SSH 安装目标服务器 Direct Gateway；如果远端安装失败，页面会保留网站中转并显示错误，不会把直连标记成成功。"
- L195 aria-label aria-label= "编辑 VPS 节点"
- _…and 8 more_

### `src/app/servers/server-create-form.tsx` — 16/24 missing (33.3%)

- L37 text "连接方式"
- L65 text "SSH 密钥"
- L74 text "选择密钥"
- L126 placeholder placeholder= "留空，不使用默认密码"
- L136 text "密码不会预填；请手动输入目标 VPS 当前 SSH 密码。"
- L164 text "添加 VPS 节点"
- L165 text "录入 SSH 密钥、IP 与端口完成纳管"
- L189 placeholder placeholder= "例如 prod-1"
- _…and 8 more_

### `src/app/files/page.tsx` — 15/17 missing (11.8%)

- L217 title title= "文件与存储管理"
- L232 text "系统自检"
- L246 text "文件节点"
- L254 text "活跃文件"
- L262 text "当前目录"
- L270 text "回收站"
- L284 text "全局文件搜索"
- L285 text "跨本地和 SFTP 节点搜索文件名，适合快速定位配置、日志和上传文件。"
- _…and 7 more_

### `src/app/servers/server-overview-details.tsx` — 15/15 missing (0%)

- L155 aria-label aria-label= "Direct Gateway 修复建议"
- L283 text "连接与状态"
- L297 text "状态徽章表示 VControlHub 是否允许该 VPS 接收操作；若 SSH
					终端、文件中转或直连访问异常，请结合下方连接摘要、直连模式和最近命令状态定位真实服务健康。"
- L302 text "指纹："
- L321 text "操作与资源"
- L359 text "诊断下一步"
- L360 text "这里展示的是可执行诊断入口：节点“启用”只表示允许接收操作，不等于 SSH、SFTP 或 Direct
							Gateway 实时在线。"
- L368 text "查看实时监控 JSON"
- _…and 7 more_

### `src/app/storage/storage-node-create-form.tsx` — 15/20 missing (25%)

- L24 text "新增存储节点"
- L25 text "支持本机存储与绑定 VPS 的 SFTP 存储节点。"
- L46 text "根目录"
- L52 text "绑定 VPS"
- L52 text "*（SFTP 必填绑定VPS或远端主机）"
- L54 text "不绑定"
- L61 text "远端主机"
- L61 text "*（SFTP 必填远端主机或绑定VPS）"
- _…and 7 more_

### `src/app/files/file-batch-toolbar.tsx` — 14/17 missing (17.6%)

- L71 text "批量操作完成，  
            个失败"
- L90 text "文件批量操作"
- L93 text "已选择   
            个文件，可取消选择或执行当前权限允许的批量操作。"
- L99 text "确认删除   个文件？"
- L121 text "已删除  /  个"
- L135 text "个失败"
- L142 text "目标路径："
- L145 aria-label aria-label= "批量移动目标路径"
- _…and 6 more_

### `src/app/operation-tasks/operation-task-list-client.tsx` — 14/20 missing (30%)

- L86 text "共   条"
- L99 text "按当前筛选结果归类失败任务，优先处理重复出现的失败模式。"
- L101 text "共   条失败"
- L106 text "来源：  · 最新："
- L113 text "最近任务"
- L114 text "可优先查看失败/运行中任务，并按 durable job 类型缩小排查范围。"
- L118 text "状态筛选"
- L124 text "任务类型"
- _…and 6 more_

### `src/app/storage/storage-node-edit-form.tsx` — 14/19 missing (26.3%)

- L41 text "编辑存储节点"
- L62 text "根目录"
- L68 text "绑定 VPS"
- L68 text "*（SFTP 必填绑定VPS或远端主机）"
- L70 text "不绑定"
- L77 text "远端主机"
- L77 text "*（SFTP 必填远端主机或绑定VPS）"
- L89 text "访问模式"
- _…and 6 more_

### `src/app/downloads/create-download-form.tsx` — 13/15 missing (13.3%)

- L89 text "新建下载任务"
- L101 text "📋 批量模式"
- L104 text "每行一个链接"
- L112 text "下载链接（每行一个）"
- L123 text "批量模式仅用于多个 HTTP/HTTPS 链接；磁力/BT 链接请单独创建任务，不要与普通链接混用。"
- L133 text "下载链接"
- L177 text "保存路径"
- L191 placeholder placeholder= "留空自动"
- _…and 5 more_

### `src/app/files/file-list-client.tsx` — 13/23 missing (43.5%)

- L394 title title= "下载目录归档"
- L759 aria-label aria-label= "全选文件"
- L781 text "修改时间"
- L799 aria-label aria-label= "选择文件夹（暂未启用）"
- L966 text "打开"
- L1086 aria-label aria-label= "关闭提醒"
- L1104 text "· 已选   个"
- L1110 title title= "列表视图"
- _…and 5 more_

### `src/app/image-bed/image-bed-page-client.tsx` — 13/19 missing (31.6%)

- L504 text "暂无图片，上传第一张吧"
- L545 text "来源："
- L563 text "上一页"
- L565 text "下一页"
- L585 text "☁️ 从云盘发布到图床"
- L588 text "存储节点（本地或 SFTP）"
- L590 text "选择存储节点"
- L595 text "文件相对路径"
- _…and 5 more_

### `src/app/scheduled-tasks/scheduled-task-list-client.tsx` — 13/22 missing (40.9%)

- L129 text "搜索定时任务 / 执行日志"
- L144 text "+ 创建定时任务"
- L174 text "原因："
- L176 text "目标节点：  台"
- L177 text "已执行：  次"
- L178 text "上次运行："
- L179 text "下次运行："
- L182 text "最近执行日志"
- _…and 5 more_

### `src/components/ssh-terminal-modal.tsx` — 13/14 missing (7.1%)

- L328 text "SSH 终端 —"
- L348 title title= "命令面板"
- L354 text "📋 命令面板"
- L362 text "重连"
- L366 aria-label aria-label= "关闭 SSH 终端"
- L395 text "⭐ 常用命令"
- L397 text "添加常用 SSH 命令"
- L400 placeholder placeholder= "添加常用命令…"
- _…and 5 more_
