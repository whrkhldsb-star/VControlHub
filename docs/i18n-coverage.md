# VControlHub i18n Coverage Report

> Generated: 2026-06-16T03:26:22.082Z | Files: 254 | Strings: 1422 | Coverage: **18.3%** (260/1422)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/health` | 4 | 0 | 4 | 0% |
| `src/app/not-found.tsx` | 2 | 0 | 2 | 0% |
| `src/app/status` | 4 | 0 | 4 | 0% |
| `src/components/app-sidebar.tsx` | 1 | 0 | 1 | 0% |
| `src/components/page-shell.tsx` | 1 | 0 | 1 | 0% |
| `src/components/storage` | 6 | 0 | 6 | 0% |
| `src/app/qa-reports` | 32 | 1 | 31 | 3.1% |
| `src/app/api-tokens` | 22 | 1 | 21 | 4.5% |
| `src/app/deployments` | 44 | 2 | 42 | 4.5% |
| `src/app/shares` | 19 | 1 | 18 | 5.3% |
| `src/app/backups` | 56 | 3 | 53 | 5.4% |
| `src/app/tickets` | 29 | 2 | 27 | 6.9% |
| `src/app/account` | 14 | 1 | 13 | 7.1% |
| `src/components/ssh-terminal-modal.tsx` | 14 | 1 | 13 | 7.1% |
| `src/app/downloads` | 39 | 3 | 36 | 7.7% |
| `src/app/preferences` | 11 | 1 | 10 | 9.1% |
| `src/app/requests` | 33 | 3 | 30 | 9.1% |
| `src/app/alert-rules` | 41 | 4 | 37 | 9.8% |
| `src/app/api-docs` | 9 | 1 | 8 | 11.1% |
| `src/app/settings` | 31 | 4 | 27 | 12.9% |
| `src/app/media` | 61 | 8 | 53 | 13.1% |
| `src/app/traffic` | 30 | 4 | 26 | 13.3% |
| `src/app/image-bed` | 76 | 11 | 65 | 14.5% |
| `src/app/monitoring` | 13 | 2 | 11 | 15.4% |
| `src/app/operation-tasks` | 37 | 6 | 31 | 16.2% |
| `src/app/quick-services` | 83 | 14 | 69 | 16.9% |
| `src/app/ai` | 88 | 16 | 72 | 18.2% |
| `src/components/change-password-modal.tsx` | 5 | 1 | 4 | 20% |
| `src/app/users` | 38 | 9 | 29 | 23.7% |
| `src/app/storage` | 46 | 11 | 35 | 23.9% |
| `src/app/servers` | 112 | 27 | 85 | 24.1% |
| `src/app/files` | 182 | 45 | 137 | 24.7% |
| `src/components/route-error.tsx` | 4 | 1 | 3 | 25% |
| `src/components/two-factor-settings.tsx` | 12 | 3 | 9 | 25% |
| `src/app/audit` | 38 | 10 | 28 | 26.3% |
| `src/app/snippets` | 33 | 9 | 24 | 27.3% |
| `src/app/announcements` | 34 | 10 | 24 | 29.4% |
| `src/app/templates` | 25 | 8 | 17 | 32% |
| `src/app/login` | 15 | 5 | 10 | 33.3% |
| `src/app/share` | 12 | 4 | 8 | 33.3% |
| `src/app/scheduled-tasks` | 26 | 9 | 17 | 34.6% |
| `src/app/notifications` | 7 | 3 | 4 | 42.9% |
| `src/app/docker` | 29 | 14 | 15 | 48.3% |
| `src/app/global-error.tsx` | 4 | 2 | 2 | 50% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t("<key>")` or the `dom-bridge` data-i18n system.

| String | Count | First 3 occurrences |
|---|---|---|
| 修改登录密码 | 2 | `src/app/account/password/change-password-form.tsx:43` (text), `src/components/change-password-modal.tsx:39` (text) |
| 保存新密码 | 2 | `src/app/account/password/change-password-form.tsx:96` (text), `src/components/change-password-modal.tsx:92` (text) |
| 打开侧边栏 | 2 | `src/app/ai/ai-chat-header.tsx:29` (aria-label), `src/app/ai/ai-sidebar.tsx:109` (aria-label) |
| + 新对话 | 2 | `src/app/ai/ai-client.tsx:988` (text), `src/app/ai/ai-sidebar.tsx:44` (text) |
| 默认 | 2 | `src/app/ai/ai-provider-panel.tsx:166` (text), `src/app/settings/settings-client.tsx:639` (text) |
| 设为默认提供商 | 2 | `src/app/ai/ai-provider-panel.tsx:238` (text), `src/app/ai/ai-provider-panel.tsx:293` (text) |
| 保存修改 | 2 | `src/app/ai/ai-provider-panel.tsx:241` (text), `src/app/storage/storage-node-edit-form.tsx:115` (text) |
| 级别 | 2 | `src/app/announcements/announcement-edit-modal.tsx:67` (text), `src/app/audit/audit-client.tsx:211` (text) |
| 🔴 紧急 | 2 | `src/app/announcements/announcement-edit-modal.tsx:77` (text), `src/app/announcements/create-announcement-form.tsx:59` (text) |
| 📌 置顶 | 2 | `src/app/announcements/announcement-edit-modal.tsx:97` (text), `src/app/announcements/announcement-list-client.tsx:131` (text) |
| 有效期至 | 2 | `src/app/announcements/announcement-list-client.tsx:152` (text), `src/app/share/[token]/page.tsx:75` (text) |
| 过期时间 | 2 | `src/app/announcements/create-announcement-form.tsx:76` (text), `src/app/api-tokens/api-token-manager-client.tsx:192` (text) |
| 缺少权限 | 2 | `src/app/api-tokens/page.tsx:15` (text), `src/components/page-shell.tsx:185` (text) |
| 搜索动作、用户名或显示名 | 2 | `src/app/audit/audit-client.tsx:109` (placeholder), `src/app/audit/audit-client.tsx:109` (aria-label) |
| 全部类型 | 2 | `src/app/audit/audit-client.tsx:163` (text), `src/app/operation-tasks/operation-task-list-client.tsx:124` (text) |
| 创建节点 | 2 | `src/app/audit/audit-client.tsx:168` (text), `src/app/storage/storage-node-create-form.tsx:99` (text) |
| 详情 | 2 | `src/app/audit/audit-client.tsx:214` (text), `src/app/files/file-list-client.tsx:351` (text) |
| 来源 | 2 | `src/app/audit/audit-client.tsx:215` (text), `src/app/files/file-list-client.tsx:778` (text) |
| 审计日志加载失败，请稍后重试。 | 2 | `src/app/audit/audit-client.tsx:221` (text), `src/app/audit/audit-client.tsx:254` (text) |
| 备份类型 | 2 | `src/app/backups/create-backup-form.tsx:26` (text), `src/app/backups/schedule-backup-form.tsx:85` (text) |
| 数据库备份 | 2 | `src/app/backups/create-backup-form.tsx:28` (text), `src/app/backups/schedule-backup-form.tsx:87` (text) |
| 文件备份 | 2 | `src/app/backups/create-backup-form.tsx:29` (text), `src/app/backups/schedule-backup-form.tsx:88` (text) |
| 完整备份 | 2 | `src/app/backups/create-backup-form.tsx:30` (text), `src/app/backups/schedule-backup-form.tsx:89` (text) |
| 恢复 | 2 | `src/app/backups/restore-backup-button.tsx:79` (text), `src/app/files/restore-button.tsx:32` (text) |
| Cron 表达式 | 2 | `src/app/backups/schedule-backup-form.tsx:93` (text), `src/app/scheduled-tasks/scheduled-task-list-client.tsx:304` (text) |

## Files with missing translations (most gaps first)

### `src/app/image-bed/image-bed-page-client.tsx` — 64/73 missing (12.3%)

- L282 text "图片外链中心"
- L283 text "这里专注管理已发布图片外链：复制 URL / Markdown / HTML、查看来源、批量归档或删除。新增图片优先从媒体库图片工作区进入。"
- L286 text "🖼 打开图片工作区"
- L287 text "☁️ 从云盘发布"
- L291 text "已发布外链"
- L292 text "可追溯来源"
- L293 text "当前页公开"
- L299 text "发布路径"
- _…and 56 more_

### `src/app/quick-services/quick-services-client.tsx` — 59/67 missing (11.9%)

- L325 text "当前角色无快捷服务管理权限"
- L403 text "Docker 环境未就绪，快捷服务安装已暂停"
- L414 text "查看任务中心"
- L432 text "运行概览"
- L433 text "个服务在线` : "还没有运行中的服务"}"
- L455 text "从推荐服务中安装 AList、Uptime Kuma 或 Portainer 后，这里会出现访问入口。"
- L460 text "个监听端口"
- L461 text "安装前会实时检查端口冲突，当前服务端口会优先显示在运行入口里。"
- _…and 51 more_

### `src/app/alert-rules/alert-rule-list-client.tsx` — 37/40 missing (7.5%)

- L132 text "删除告警规则"
- L133 text "确认删除告警规则"
- L147 text "` ? "删除中…" : "确认删除"}"
- L156 text "+ 创建告警规则"
- L180 text "测试发送结果："
- L198 text "暂无告警规则"
- L214 text "持续  s"
- L224 text "Webhook 已配置"
- _…and 29 more_

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

### `src/app/media/page.tsx` — 28/30 missing (6.7%)

- L61 text "一个入口完成媒体浏览、筛选、扫描和图片外链发布；旧“图床”只作为已发布外链的管理与审计中心。"
- L64 text "图片"
- L65 text "视频"
- L66 text "音频"
- L81 text "🔗 外链中心"
- L85 text "当前视图   项"
- L89 aria-label aria-label= "媒体类型"
- L91 text "全部"
- _…and 20 more_

### `src/app/settings/settings-client.tsx` — 27/30 missing (10%)

- L242 text "当前角色无系统设置权限"
- L253 text "✓ 设置已保存 ` : ""}"
- L259 aria-label aria-label= "设置分类导航"
- L262 text "⚙️ 设置分类"
- L263 text "点击下方分类快速跳转，或一键展开/折叠所有分组。常用项默认展开，运行参数等高级项默认折叠。"
- L270 text "全部展开"
- L277 text "全部折叠"
- L572 text "最近修改"
- _…and 19 more_

### `src/app/operation-tasks/operation-task-list-client.tsx` — 26/28 missing (7.1%)

- L75 text "{[["running","运行中"],["pending","待处理"],["failed","失败"],["completed","已完成"]].map(([key,label]) =>"
- L78 aria-label aria-label= "来源聚合"
- L81 text "来源聚合"
- L82 text "按任务来源汇总当前筛选结果，优先显示失败/运行中/待处理数量。"
- L84 text "共   条"
- L86 text "暂无来源分布"
- L88 text "总计"
- L89 text "需处理"
- _…and 18 more_

### `src/app/traffic/traffic-page-client.tsx` — 26/30 missing (13.3%)

- L155 text "查看当前服务器网卡流量，并关联存储服务器/远程节点流量来源。"
- L159 text "自动刷新` : refreshIntervalSeconds"
- L166 title title= "当前服务器实时流量"
- L172 text "网卡"
- L174 text "自动选择主网卡"
- L177 text "最后更新："
- L186 text "累计下载："
- L187 text "累计上传："
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

### `src/app/ai/ai-client.tsx` — 23/24 missing (4.2%)

- L568 text "修改对话标题"
- L569 text "新标题"
- L571 placeholder placeholder= "输入新的对话标题"
- L679 text "发送消息开始对话"
- L680 text "支持:   · 拖拽/粘贴上传"
- L705 text "💭 思考过程"
- L787 text "💭 正在思考..."
- L806 text "正在思考..."
- _…and 15 more_

### `src/app/audit/audit-client.tsx` — 21/30 missing (30%)

- L109 placeholder placeholder= "搜索动作、用户名或显示名"
- L109 aria-label aria-label= "搜索动作、用户名或显示名"
- L140 aria-label aria-label= "按严重级别过滤"
- L149 text "全部级别"
- L154 aria-label aria-label= "按动作类型过滤"
- L163 text "全部类型"
- L165 text "登录失败"
- L167 text "删除文件"
- _…and 13 more_

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

### `src/app/files/files-browser-spa.tsx` — 21/27 missing (22.2%)

- L207 text "当前："
- L222 text "搜索存储节点"
- L225 placeholder placeholder= "节点名称、类型或 ID"
- L235 text "选择存储节点"
- L244 text "🌐 全部节点"
- L253 text "没有匹配的节点"
- L396 aria-label aria-label= "面包屑"
- L527 aria-label aria-label= "目录树"
- _…and 13 more_

### `src/app/qa-reports/qa-reports-list-client.tsx` — 21/21 missing (0%)

- L94 aria-label aria-label= "维护环趋势"
- L96 text "维护环趋势"
- L97 text "数据来源 .hermes/autonomous-maintenance-state.json#completed_runs[]。总 tick、成功率、模块覆盖、最近失败摘要。"
- L105 text "当前 .hermes/autonomous-maintenance-state.json 不可用或暂无 completed_runs 历史。"
- L125 text "近 7 日 tick 数（绿=成功 / 琥珀=失败）"
- L126 text "峰值"
- L128 aria-label aria-label= "近 7 日 tick 柱状图"
- L161 text "模块覆盖（按访问次数排序，截前 6）"
- _…and 13 more_

### `src/app/ai/ai-settings-panel.tsx` — 20/22 missing (9.1%)

- L57 text "模型
            {modelsLoading &&"
- L72 placeholder placeholder= "搜索模型..."
- L72 aria-label aria-label= "搜索模型"
- L72 text "无可用模型"
- L79 title title= "支持图片"
- L82 title title= "支持视频"
- L85 title title= "支持音频"
- L88 title title= "支持文档"
- _…and 12 more_

### `src/app/api-tokens/api-token-manager-client.tsx` — 17/18 missing (5.6%)

- L118 text "一次性明文 Token"
- L119 text "请立即复制，此明文 Token 离开页面后无法再次查看。"
- L121 text "复制 Token"
- L132 text "创建 API Token"
- L133 text "Token 仅在创建成功后显示一次；后端只保存哈希和脱敏标识。"
- L137 text "Token 名称"
- L138 placeholder placeholder= "例如：移动端 CLI / 监控脚本"
- L141 text "过期时间（可选）"
- _…and 9 more_

### `src/app/files/file-list-client.tsx` — 17/23 missing (26.1%)

- L325 title title= "资料详情"
- L351 text "详情"
- L394 title title= "下载目录归档"
- L615 text "目录"
- L759 aria-label aria-label= "全选文件"
- L778 text "来源"
- L781 text "修改时间"
- L799 aria-label aria-label= "选择文件夹（暂未启用）"
- _…and 9 more_

### `src/app/scheduled-tasks/scheduled-task-list-client.tsx` — 17/25 missing (32%)

- L125 text "搜索定时任务 / 执行日志"
- L126 placeholder placeholder= "按名称、命令、Cron、上次结果搜索"
- L140 text "+ 创建定时任务"
- L170 text "原因："
- L172 text "目标节点：  台"
- L173 text "已执行：  次"
- L174 text "上次运行："
- L175 text "下次运行："
- _…and 9 more_

### `src/app/servers/server-card-actions.tsx` — 17/24 missing (29.2%)

- L109 aria-label aria-label= "目标服务器直连网关控制"
- L121 text "直连状态："
- L134 text "当前上传、下载、在线浏览默认走网站中转。"
- L142 text "直连服务已声明启用。"
- L145 text "若文件预览/下载异常，请先确认目标 VPS 上 Direct Gateway
                    进程仍在监听  ，并检查防火墙是否放行该端口；切回网站中转会先尝试卸载远端服务，成功后再更新数据库状态。"
- L152 text "启用前检查：VPS 必须绑定 SFTP 存储节点且不是本机地址。"
- L155 text "点击启用会通过 SSH 安装目标服务器 Direct Gateway；如果远端安装失败，页面会保留网站中转并显示错误，不会把直连标记成成功。"
- L195 aria-label aria-label= "编辑 VPS 节点"
- _…and 9 more_

### `src/app/templates/template-list-client.tsx` — 17/24 missing (29.2%)

- L84 text "删除命令模板"
- L85 text "确认删除模板"
- L110 text "筛选"
- L115 text "全部"
- L135 text "+ 创建模板"
- L147 text "暂无命令模板"
- L160 text "内置"
- L229 text "一键下发"
- _…and 9 more_
