# VControlHub i18n Coverage Report

> Generated: 2026-06-15T08:12:48.015Z | Files: 246 | Strings: 1410 | Coverage: **11.6%** (164/1410)

This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).

Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.

## Module coverage (lowest first)

| Module | Strings | Covered | Missing | Coverage |
|---|---|---|---|---|
| `src/app/error.tsx` | 4 | 0 | 4 | 0% |
| `src/app/global-error.tsx` | 4 | 0 | 4 | 0% |
| `src/app/health` | 4 | 0 | 4 | 0% |
| `src/app/not-found.tsx` | 2 | 0 | 2 | 0% |
| `src/app/status` | 4 | 0 | 4 | 0% |
| `src/app/tickets` | 29 | 0 | 29 | 0% |
| `src/components/app-sidebar.tsx` | 1 | 0 | 1 | 0% |
| `src/components/page-shell.tsx` | 1 | 0 | 1 | 0% |
| `src/components/route-error.tsx` | 4 | 0 | 4 | 0% |
| `src/components/ssh-terminal-modal.tsx` | 14 | 0 | 14 | 0% |
| `src/components/storage` | 6 | 0 | 6 | 0% |
| `src/app/deployments` | 44 | 1 | 43 | 2.3% |
| `src/app/downloads` | 39 | 1 | 38 | 2.6% |
| `src/app/requests` | 33 | 1 | 32 | 3% |
| `src/app/qa-reports` | 32 | 1 | 31 | 3.1% |
| `src/app/api-tokens` | 22 | 1 | 21 | 4.5% |
| `src/app/settings` | 19 | 1 | 18 | 5.3% |
| `src/app/shares` | 19 | 1 | 18 | 5.3% |
| `src/app/backups` | 56 | 3 | 53 | 5.4% |
| `src/app/media` | 61 | 4 | 57 | 6.6% |
| `src/app/alert-rules` | 41 | 3 | 38 | 7.3% |
| `src/app/operation-tasks` | 37 | 3 | 34 | 8.1% |
| `src/app/account` | 12 | 1 | 11 | 8.3% |
| `src/app/preferences` | 11 | 1 | 10 | 9.1% |
| `src/app/image-bed` | 76 | 7 | 69 | 9.2% |
| `src/app/quick-services` | 83 | 8 | 75 | 9.6% |
| `src/app/servers` | 112 | 12 | 100 | 10.7% |
| `src/app/storage` | 46 | 5 | 41 | 10.9% |
| `src/app/api-docs` | 9 | 1 | 8 | 11.1% |
| `src/app/ai` | 85 | 11 | 74 | 12.9% |
| `src/app/traffic` | 30 | 4 | 26 | 13.3% |
| `src/app/snippets` | 33 | 5 | 28 | 15.2% |
| `src/app/monitoring` | 13 | 2 | 11 | 15.4% |
| `src/app/scheduled-tasks` | 26 | 4 | 22 | 15.4% |
| `src/app/users` | 38 | 6 | 32 | 15.8% |
| `src/app/share` | 12 | 2 | 10 | 16.7% |
| `src/app/files` | 182 | 31 | 151 | 17% |
| `src/app/announcements` | 34 | 6 | 28 | 17.6% |
| `src/app/templates` | 25 | 5 | 20 | 20% |
| `src/components/change-password-modal.tsx` | 5 | 1 | 4 | 20% |
| `src/app/audit` | 39 | 8 | 31 | 20.5% |
| `src/components/two-factor-settings.tsx` | 12 | 3 | 9 | 25% |
| `src/app/login` | 15 | 5 | 10 | 33.3% |
| `src/app/notifications` | 7 | 3 | 4 | 42.9% |
| `src/app/docker` | 29 | 13 | 16 | 44.8% |

## Top missing strings (frequency-sorted)

Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t("<key>")` or the `dom-bridge` data-i18n system.

| String | Count | First 3 occurrences |
|---|---|---|
| 加载中… | 8 | `src/app/audit/audit-client.tsx:217` (text), `src/app/audit/audit-client.tsx:250` (text), `src/app/downloads/downloads-client.tsx:375` (text) |
| 确认删除 | 6 | `src/app/docker/docker-page-client.tsx:398` (text), `src/app/files/file-list-client.tsx:1485` (text), `src/app/quick-services/pending-source-delete-dialog.tsx:50` (text) |
| 下载 | 6 | `src/app/files/file-list-client.tsx:394` (title), `src/app/files/file-list-client.tsx:408` (text), `src/app/files/file-list-client.tsx:433` (text) |
| 默认模型 | 5 | `src/app/ai/ai-provider-panel.tsx:233` (text), `src/app/ai/ai-provider-panel.tsx:234` (aria-label), `src/app/ai/ai-provider-panel.tsx:270` (text) |
| 目标节点 | 5 | `src/app/alert-rules/alert-rule-list-client.tsx:377` (text), `src/app/files/create-folder-form.tsx:89` (text), `src/app/requests/page.tsx:100` (title) |
| 标题 | 5 | `src/app/announcements/announcement-edit-modal.tsx:57` (text), `src/app/announcements/create-announcement-form.tsx:50` (text), `src/app/snippets/create-snippet-modal.tsx:73` (text) |
| 重试 | 5 | `src/app/error.tsx:37` (text), `src/app/global-error.tsx:51` (text), `src/app/scheduled-tasks/scheduled-task-list-client.tsx:188` (text) |
| 关闭 | 5 | `src/app/files/file-list-client.tsx:1321` (text), `src/app/operation-tasks/job-events-dialog.tsx:149` (aria-label), `src/app/operation-tasks/job-events-dialog.tsx:155` (text) |
| 端口 | 5 | `src/app/quick-services/quick-services-client.tsx:459` (text), `src/app/quick-services/quick-services-client.tsx:946` (text), `src/app/servers/server-create-form.tsx:236` (text) |
| 可选 | 5 | `src/app/scheduled-tasks/scheduled-task-list-client.tsx:329` (placeholder), `src/app/servers/command-create-form.tsx:61` (placeholder), `src/app/servers/server-create-form.tsx:205` (placeholder) |
| 描述 | 5 | `src/app/servers/server-card-actions.tsx:277` (text), `src/app/servers/server-create-form.tsx:202` (text), `src/app/servers/ssh-key-create-form.tsx:31` (text) |
| 内容 | 4 | `src/app/announcements/announcement-edit-modal.tsx:81` (text), `src/app/announcements/create-announcement-form.tsx:65` (text), `src/app/snippets/create-snippet-modal.tsx:117` (text) |
| 路径 | 4 | `src/app/files/recycle-bin-section-client.tsx:61` (text), `src/app/media/[id]/page.tsx:273` (text), `src/app/quick-services/quick-services-client.tsx:947` (text) |
| 节点名称 | 4 | `src/app/servers/server-card-actions.tsx:205` (text), `src/app/servers/server-create-form.tsx:186` (text), `src/app/storage/storage-node-create-form.tsx:30` (text) |
| 清除 | 3 | `src/app/audit/audit-client.tsx:133` (text), `src/app/files/files-browser-spa.tsx:216` (text), `src/app/files/files-browser-spa.tsx:672` (text) |
| 目标 VPS | 3 | `src/app/deployments/deployment-launch-form.tsx:140` (text), `src/app/downloads/create-download-form.tsx:147` (text), `src/app/requests/ai-hosted-approval-card.tsx:73` (text) |
| 驱动 | 3 | `src/app/files/file-list-client.tsx:1335` (text), `src/app/storage/storage-node-create-form.tsx:34` (text), `src/app/storage/storage-node-edit-form.tsx:50` (text) |
| 全部文件 | 3 | `src/app/files/files-browser-spa.tsx:404` (text), `src/app/files/files-browser-spa.tsx:568` (text), `src/app/files/search-scope-toggle.tsx:53` (text) |
| 复制外链 | 3 | `src/app/image-bed/image-bed-page-client.tsx:533` (title), `src/app/image-bed/image-bed-page-client.tsx:533` (aria-label), `src/app/image-bed/image-preview-modal.tsx:76` (text) |
| 标签 | 3 | `src/app/media/[id]/page.tsx:285` (text), `src/app/servers/server-card-actions.tsx:290` (text), `src/app/servers/server-create-form.tsx:298` (text) |
| 环境变量： | 3 | `src/app/quick-services/quick-services-client.tsx:823` (text), `src/app/settings/settings-client.tsx:559` (text), `src/app/settings/settings-client.tsx:623` (text) |
| 命令内容 | 3 | `src/app/scheduled-tasks/scheduled-task-list-client.tsx:323` (text), `src/app/servers/command-create-form.tsx:55` (text), `src/app/templates/template-list-client.tsx:326` (text) |
| 修改登录密码 | 2 | `src/app/account/password/change-password-form.tsx:18` (text), `src/components/change-password-modal.tsx:39` (text) |
| 保存新密码 | 2 | `src/app/account/password/change-password-form.tsx:53` (text), `src/components/change-password-modal.tsx:92` (text) |
| + 新对话 | 2 | `src/app/ai/ai-client.tsx:1048` (text), `src/app/ai/ai-sidebar.tsx:44` (text) |

## Files with missing translations (most gaps first)

### `src/app/image-bed/image-bed-page-client.tsx` — 67/73 missing (8.2%)

- L282 text "图片外链中心"
- L283 text "这里专注管理已发布图片外链：复制 URL / Markdown / HTML、查看来源、批量归档或删除。新增图片优先从媒体库图片工作区进入。"
- L286 text "🖼 打开图片工作区"
- L287 text "☁️ 从云盘发布"
- L291 text "已发布外链"
- L292 text "可追溯来源"
- L293 text "当前页公开"
- L299 text "发布路径"
- _…and 59 more_

### `src/app/quick-services/quick-services-client.tsx` — 64/67 missing (4.5%)

- L318 text "加载中…"
- L325 text "当前角色无快捷服务管理权限"
- L403 text "Docker 环境未就绪，快捷服务安装已暂停"
- L414 text "查看任务中心"
- L432 text "运行概览"
- L433 text "个服务在线` : "还没有运行中的服务"}"
- L455 text "从推荐服务中安装 AList、Uptime Kuma 或 Portainer 后，这里会出现访问入口。"
- L459 text "端口"
- _…and 56 more_

### `src/app/files/file-list-client.tsx` — 47/54 missing (13%)

- L352 title title= "资料详情"
- L378 text "详情"
- L394 title title= "下载"
- L408 text "下载"
- L421 title title= "下载目录归档"
- L433 text "下载"
- L446 title title= "更多操作"
- L457 text "更多"
- _…and 39 more_

### `src/app/alert-rules/alert-rule-list-client.tsx` — 38/40 missing (5%)

- L132 text "删除告警规则"
- L133 text "确认删除告警规则"
- L147 text "` ? "删除中…" : "确认删除"}"
- L156 text "+ 创建告警规则"
- L180 text "测试发送结果："
- L198 text "暂无告警规则"
- L214 text "持续  s"
- L224 text "Webhook 已配置"
- _…and 30 more_

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

### `src/app/files/files-browser-spa.tsx` — 26/27 missing (3.7%)

- L207 text "当前："
- L216 text "清除"
- L222 text "搜索存储节点"
- L225 placeholder placeholder= "节点名称、类型或 ID"
- L235 text "选择存储节点"
- L244 text "🌐 全部节点"
- L253 text "没有匹配的节点"
- L396 aria-label aria-label= "面包屑"
- _…and 18 more_

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

### `src/app/ai/ai-client.tsx` — 25/26 missing (3.8%)

- L567 text "修改对话标题"
- L568 text "新标题"
- L570 placeholder placeholder= "输入新的对话标题"
- L678 text "发送消息开始对话"
- L679 text "支持:   · 拖拽/粘贴上传"
- L704 text "💭 思考过程"
- L786 text "💭 正在思考..."
- L805 text "正在思考..."
- _…and 17 more_

### `src/app/audit/audit-client.tsx` — 24/31 missing (22.6%)

- L107 placeholder placeholder= "搜索动作、用户名或显示名"
- L107 aria-label aria-label= "搜索动作、用户名或显示名"
- L133 text "清除"
- L138 aria-label aria-label= "按严重级别过滤"
- L147 text "全部级别"
- L152 aria-label aria-label= "按动作类型过滤"
- L161 text "全部类型"
- L163 text "登录失败"
- _…and 16 more_

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

### `src/app/downloads/downloads-client.tsx` — 22/22 missing (0%)

- L292 text "全局下载速度"
- L296 text "活跃任务"
- L300 text "等待中"
- L304 text "全局限速"
- L311 text "需 manage-node 权限"
- L319 text "⬇   个下载中"
- L320 text "⏳   个等待中"
- L354 text "暂无可用下载目标：请先在 VPS 管理中为节点绑定存储并配置 SSH。"
- _…and 14 more_

### `src/app/scheduled-tasks/scheduled-task-list-client.tsx` — 22/25 missing (12%)

- L125 text "搜索定时任务 / 执行日志"
- L126 placeholder placeholder= "按名称、命令、Cron、上次结果搜索"
- L140 text "+ 创建定时任务"
- L170 text "原因："
- L172 text "目标节点：  台"
- L173 text "已执行：  次"
- L174 text "上次运行："
- L175 text "下次运行："
- _…and 14 more_

### `src/app/ai/ai-provider-panel.tsx` — 21/27 missing (22.2%)

- L142 text "AI 提供商管理"
- L143 aria-label aria-label= "关闭提供商管理"
- L157 text "已添加的提供商"
- L166 text "默认"
- L167 text "已禁用"
- L210 text "编辑提供商"
- L211 text "取消编辑"
- L226 placeholder placeholder= "留空保持不变"
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

### `src/app/servers/server-card-actions.tsx` — 21/24 missing (12.5%)

- L109 aria-label aria-label= "目标服务器直连网关控制"
- L121 text "直连状态："
- L134 text "当前上传、下载、在线浏览默认走网站中转。"
- L142 text "直连服务已声明启用。"
- L145 text "若文件预览/下载异常，请先确认目标 VPS 上 Direct Gateway
                    进程仍在监听  ，并检查防火墙是否放行该端口；切回网站中转会先尝试卸载远端服务，成功后再更新数据库状态。"
- L152 text "启用前检查：VPS 必须绑定 SFTP 存储节点且不是本机地址。"
- L155 text "点击启用会通过 SSH 安装目标服务器 Direct Gateway；如果远端安装失败，页面会保留网站中转并显示错误，不会把直连标记成成功。"
- L195 aria-label aria-label= "编辑 VPS 节点"
- _…and 13 more_

### `src/app/servers/server-create-form.tsx` — 21/24 missing (12.5%)

- L37 text "连接方式"
- L65 text "SSH 密钥"
- L74 text "选择密钥"
- L126 placeholder placeholder= "留空，不使用默认密码"
- L136 text "密码不会预填；请手动输入目标 VPS 当前 SSH 密码。"
- L164 text "添加 VPS 节点"
- L165 text "录入 SSH 密钥、IP 与端口完成纳管"
- L186 text "节点名称"
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

### `src/app/templates/template-list-client.tsx` — 20/24 missing (16.7%)

- L84 text "删除命令模板"
- L85 text "确认删除模板"
- L98 text "确认删除"
- L110 text "筛选"
- L115 text "全部"
- L135 text "+ 创建模板"
- L147 text "暂无命令模板"
- L160 text "内置"
- _…and 12 more_
