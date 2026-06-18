# VControlHub i18n Coverage Report

> Generated: 2026-06-18T05:14:38.645Z | Files: 273 | Strings: 485 | Coverage: **32.8%** (159/485)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/deployments` | 38 | 1 | 37 | 2.6% |
| `src/app/media` | 38 | 7 | 31 | 18.4% |
| `src/app/quick-services` | 38 | 7 | 31 | 18.4% |
| `src/app/settings` | 30 | 6 | 24 | 20% |
| `src/components/two-factor-settings.tsx` | 12 | 3 | 9 | 25% |
| `src/app/servers` | 87 | 29 | 58 | 33.3% |
| `src/app/storage` | 43 | 15 | 28 | 34.9% |
| `src/app/files` | 121 | 45 | 76 | 37.2% |
| `src/app/audit` | 12 | 5 | 7 | 41.7% |
| `src/app/operation-tasks` | 9 | 4 | 5 | 44.4% |
| `src/app/backups` | 8 | 4 | 4 | 50% |
| `src/app/global-error.tsx` | 4 | 2 | 2 | 50% |
| `src/app/share` | 12 | 6 | 6 | 50% |
| `src/app/downloads` | 7 | 4 | 3 | 57.1% |
| `src/app/image-bed` | 5 | 3 | 2 | 60% |
| `src/app/shares` | 3 | 2 | 1 | 66.7% |
| `src/app/scheduled-tasks` | 13 | 11 | 2 | 84.6% |
| `src/app/announcements` | 1 | 1 | 0 | 100% |
| `src/app/requests` | 1 | 1 | 0 | 100% |
| `src/components/change-password-modal.tsx` | 2 | 2 | 0 | 100% |
| `src/components/page-shell.tsx` | 1 | 1 | 0 | 100% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t("<key>")` or the `dom-bridge` data-i18n system.

| String | Count | First 3 occurrences |
|---|---|---|
| 目录树 | 3 | `src/app/deployments/deployment-export-panel.tsx:325` (text), `src/app/files/files-browser-spa.tsx:527` (aria-label), `src/app/files/files-browser-spa.tsx:536` (text) |
| 列表视图 | 2 | `src/app/files/file-list-client.tsx:1110` (title), `src/app/files/file-list-client.tsx:1110` (aria-label) |
| 图标视图 | 2 | `src/app/files/file-list-client.tsx:1141` (title), `src/app/files/file-list-client.tsx:1141` (aria-label) |
| 详情视图 | 2 | `src/app/files/file-list-client.tsx:1170` (title), `src/app/files/file-list-client.tsx:1170` (aria-label) |
| 移动 | 2 | `src/app/files/move-inline-form.tsx:66` (title), `src/app/files/move-inline-form.tsx:90` (text) |
| 当前目录 | 2 | `src/app/files/page.tsx:262` (text), `src/app/files/search-scope-toggle.tsx:42` (text) |
| 回收站 | 2 | `src/app/files/page.tsx:270` (text), `src/app/files/page.tsx:304` (text) |
| 确认删除「 」？ | 2 | `src/app/servers/server-card-actions.tsx:350` (text), `src/app/storage/storage-node-delete-button.tsx:39` (text) |
| 当前运行值： | 2 | `src/app/settings/settings-client.tsx:797` (text), `src/app/settings/settings-client.tsx:883` (text) |
| 生效位置： | 2 | `src/app/settings/settings-client.tsx:800` (text), `src/app/settings/settings-client.tsx:886` (text) |
| 保存后需重启对应服务才会改变已启动进程。 | 2 | `src/app/settings/settings-client.tsx:806` (text), `src/app/settings/settings-client.tsx:892` (text) |
| 原值 | 2 | `src/app/settings/settings-client.tsx:1052` (text), `src/app/settings/settings-client.tsx:1140` (text) |
| 新值 | 2 | `src/app/settings/settings-client.tsx:1053` (text), `src/app/settings/settings-client.tsx:1144` (text) |
| 绑定 VPS | 2 | `src/app/storage/storage-node-create-form.tsx:52` (text), `src/app/storage/storage-node-edit-form.tsx:68` (text) |
| *（SFTP 必填绑定VPS或远端主机） | 2 | `src/app/storage/storage-node-create-form.tsx:52` (text), `src/app/storage/storage-node-edit-form.tsx:68` (text) |
| 不绑定 | 2 | `src/app/storage/storage-node-create-form.tsx:54` (text), `src/app/storage/storage-node-edit-form.tsx:70` (text) |
| 远端主机 | 2 | `src/app/storage/storage-node-create-form.tsx:61` (text), `src/app/storage/storage-node-edit-form.tsx:77` (text) |
| *（SFTP 必填远端主机或绑定VPS） | 2 | `src/app/storage/storage-node-create-form.tsx:61` (text), `src/app/storage/storage-node-edit-form.tsx:77` (text) |
| 访问模式 | 2 | `src/app/storage/storage-node-create-form.tsx:73` (text), `src/app/storage/storage-node-edit-form.tsx:89` (text) |
| 网站服务器中转（最安全） | 2 | `src/app/storage/storage-node-create-form.tsx:75` (text), `src/app/storage/storage-node-edit-form.tsx:91` (text) |
| 存储服务器直连（需签名外链服务） | 2 | `src/app/storage/storage-node-create-form.tsx:76` (text), `src/app/storage/storage-node-edit-form.tsx:92` (text) |
| 自动：可直连则直连，否则中转 | 2 | `src/app/storage/storage-node-create-form.tsx:77` (text), `src/app/storage/storage-node-edit-form.tsx:93` (text) |
| 直连基础 URL | 2 | `src/app/storage/storage-node-create-form.tsx:81` (text), `src/app/storage/storage-node-edit-form.tsx:97` (text) |
| 直连链接有效期（秒） | 2 | `src/app/storage/storage-node-create-form.tsx:85` (text), `src/app/storage/storage-node-edit-form.tsx:101` (text) |
| 设为默认存储节点 | 2 | `src/app/storage/storage-node-create-form.tsx:91` (text), `src/app/storage/storage-node-edit-form.tsx:107` (text) |

## Files with missing translations (most gaps first)

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

### `src/app/settings/settings-client.tsx` — 24/29 missing (17.2%)

- L244 text "当前角色无系统设置权限"
- L255 text "✓ 设置已保存 ` : ""}"
- L264 text "⚙️ 设置分类"
- L265 text "点击下方分类快速跳转，或一键展开/折叠所有分组。常用项默认展开，运行参数等高级项默认折叠。"
- L272 text "全部展开"
- L279 text "全部折叠"
- L574 text "最近修改"
- L575 text "时间："
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

### `src/app/files/files-browser-spa.tsx` — 19/27 missing (29.6%)

- L207 text "当前："
- L222 text "搜索存储节点"
- L225 placeholder placeholder= "节点名称、类型或 ID"
- L244 text "🌐 全部节点"
- L253 text "没有匹配的节点"
- L396 aria-label aria-label= "面包屑"
- L527 aria-label aria-label= "目录树"
- L536 text "目录树"
- _…and 11 more_

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

### `src/app/files/page.tsx` — 14/17 missing (17.6%)

- L217 title title= "文件与存储管理"
- L246 text "文件节点"
- L254 text "活跃文件"
- L262 text "当前目录"
- L270 text "回收站"
- L284 text "全局文件搜索"
- L285 text "跨本地和 SFTP 节点搜索文件名，适合快速定位配置、日志和上传文件。"
- L288 text "打开全局搜索"
- _…and 6 more_

### `src/app/storage/storage-node-create-form.tsx` — 14/20 missing (30%)

- L24 text "新增存储节点"
- L25 text "支持本机存储与绑定 VPS 的 SFTP 存储节点。"
- L52 text "绑定 VPS"
- L52 text "*（SFTP 必填绑定VPS或远端主机）"
- L54 text "不绑定"
- L61 text "远端主机"
- L61 text "*（SFTP 必填远端主机或绑定VPS）"
- L73 text "访问模式"
- _…and 6 more_

### `src/app/storage/storage-node-edit-form.tsx` — 13/19 missing (31.6%)

- L41 text "编辑存储节点"
- L68 text "绑定 VPS"
- L68 text "*（SFTP 必填绑定VPS或远端主机）"
- L70 text "不绑定"
- L77 text "远端主机"
- L77 text "*（SFTP 必填远端主机或绑定VPS）"
- L89 text "访问模式"
- L91 text "网站服务器中转（最安全）"
- _…and 5 more_

### `src/app/files/file-list-client.tsx` — 12/23 missing (47.8%)

- L394 title title= "下载目录归档"
- L759 aria-label aria-label= "全选文件"
- L799 aria-label aria-label= "选择文件夹（暂未启用）"
- L966 text "打开"
- L1086 aria-label aria-label= "关闭提醒"
- L1104 text "· 已选   个"
- L1110 title title= "列表视图"
- L1110 aria-label aria-label= "列表视图"
- _…and 4 more_

### `src/app/deployments/deployment-export-panel.tsx` — 11/11 missing (0%)

- L218 text "迁移部署导出包"
- L219 text "生成可审计的便携部署模板：环境变量示例、systemd 单元、Caddy 示例和部署脚本。导出内容只包含占位符，不会写入生产密钥或连接串。"
- L229 text "目标域名"
- L238 text "应用标识"
- L266 text "·   个文件 ·   KB · 危险演示开关默认关闭"
- L325 text "目录树"
- L327 text "暂无文件"
- L395 text "查看中"
- _…and 3 more_

### `src/app/servers/ssh-key-create-form.tsx` — 10/13 missing (23.1%)

- L18 text "添加 SSH 密钥"
- L19 text "用于节点纳管的 SSH 密钥对"
- L27 placeholder placeholder= "例如 prod-key"
- L35 text "可直接粘贴 OpenSSH 私钥，也可以只上传 PuTTY .ppk 文件；上传 .ppk 时后端会自动转换并提取公钥。"
- L40 text "私钥"
- L41 placeholder placeholder= "粘贴 SSH 私钥内容；如果上传 .ppk 可留空"
- L45 text "公钥"
- L50 text "PuTTY .ppk 上传"
- _…and 2 more_

### `src/app/servers/batch-server-action-panel.tsx` — 9/10 missing (10%)

- L45 text "批量节点操作"
- L46 text "先勾选节点，再统一启用或停用。适合维护窗口和巡检后的回收操作。"
- L48 text "当前共有   台启用节点，已选中   台"
- L58 text "已选中：  台"
- L60 text "其中启用   台，停用   台"
- L61 text "当前为部分选择"
- L88 text "确认停用   台节点"
- L97 text "批量停用所选节点"
- _…and 1 more_

### `src/components/two-factor-settings.tsx` — 9/12 missing (25%)

- L81 text "🔐 两步验证 (2FA)"
- L93 text "启用两步验证后，登录时需要输入验证器 App 生成的6位动态验证码，增强账户安全性。"
- L108 text "两步验证已启用。如需关闭，请输入验证器 App 中的当前验证码。"
- L122 text "1. 使用验证器 App（如 Google Authenticator、Microsoft Authenticator）扫描下方二维码"
- L134 text "密钥（手动输入）："
- L137 text "2. 输入验证器 App 中显示的6位验证码："
- L140 text "6位验证码"
- L172 text "输入验证器 App 中的当前验证码以关闭两步验证："
- _…and 1 more_

### `src/app/media/[id]/page.tsx` — 8/13 missing (38.5%)

- L136 text "← 返回媒体库"
- L160 text "打开源文件"
- L185 text "此媒体类型暂不支持在线预览，请下载后查看。"
- L190 aria-label aria-label= "媒体播放导航"
- L199 text "上一项"
- L205 text "已经是第一项"
- L214 text "下一项"
- L220 text "已经是最后一项"

### `src/app/audit/page.tsx` — 7/8 missing (12.5%)

- L42 text "回到首页"
- L43 text "去系统自检"
- L62 text "高风险动作监控"
- L63 text "已重点跟踪命令执行、文件删除、服务器删除、权限变更、容器重启和令牌创建。当前 WARNING 占比  % ，CRITICAL 占比  % ，异常增多时优先从下方日志按动作筛选复核。"
- L70 text "按动作筛查："
- L77 text "最常见动作"
- L80 text "暂无动作统计。"

### `src/app/quick-services/config-preview-dialog.tsx` — 7/9 missing (22.2%)

- L72 text "请确认端口、挂载和公开访问边界后继续。"
- L77 text "服务："
- L81 text "镜像："
- L85 text "端口："
- L89 text "额外端口："
- L99 text "宿主机挂载："
- L105 text "公开端口不会经过 VControlHub 登录鉴权；若服务暴露到公网，请确认防火墙、VPN、反代或应用自身账号已配置。"

### `src/app/share/[token]/page.tsx` — 6/12 missing (50%)

- L82 text "有效期"
- L83 text "永久有效"
- L93 text "可下载文件"
- L94 text "最多显示 200 个已索引文件"
- L99 text "⬇ 下载整个目录"
- L104 text "当前目录暂未发现可下载文件。系统已自动尝试刷新目录索引，请稍后重试或联系分享者确认目录内有文件。"
