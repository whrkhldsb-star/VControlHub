/**
 * i18n dictionary: `healthPage.*` keys.
 *
 * Used by:
 *   - `src/app/health/page.tsx` (server component): PageHeader title / description
 *   - `src/app/health/health-dashboard-client.tsx` (client component): all UI strings
 *
 * The client component previously held a `healthCopy` Record<"zh"|"en", ...> object
 * with ~92 hardcoded strings. Those have been extracted here.
 */
export const zh: Record<string, string> = {
	"healthPage.title": "节点健康",
	"healthPage.description": "实时采集 SSH 指标、保存历史趋势，并与告警规则联动。",
	"healthPage.serverCount": "纳管节点 {count} 台",
	"healthPage.noPermission": "缺少健康监控权限",
	"healthPage.noPermissionHint": "需要 health:read 权限后才能查看节点健康详情和历史指标。",

	// Status labels
	"healthPage.status.healthy": "正常",
	"healthPage.status.warning": "警告",
	"healthPage.status.critical": "严重",
	"healthPage.status.offline": "离线",
	"healthPage.status.unknown": "未知",

	// Summary cards
	"healthPage.summary.total": "节点总数",
	"healthPage.summary.online": "在线正常",
	"healthPage.summary.warning": "性能警告",
	"healthPage.summary.critical": "严重告警",
	"healthPage.summary.offline": "离线/停用",

	// UI strings
	"healthPage.ui.selfCheck": "系统自检",
	"healthPage.ui.collectingMetrics": "正在采集自检指标…",
	"healthPage.ui.repairSuggestions": "修复建议",
	"healthPage.ui.checksSummary": "{total} 项检查 · {healthy} 正常 · {warning} 警告 · {critical} 严重",
	"healthPage.ui.auditLog": "看审计日志",
	"healthPage.ui.home": "回到首页",
	"healthPage.ui.suggestedAction": "建议动作：",
	"healthPage.ui.lastRefresh": "上次刷新",
	"healthPage.ui.overallCritical": "有严重告警",
	"healthPage.ui.overallWarning": "有警告项",
	"healthPage.ui.overallHealthy": "当前整体正常",
	"healthPage.ui.refreshAria": "刷新健康状态",
	"healthPage.ui.refreshing": "正在刷新...",
	"healthPage.ui.refresh": "🔄 刷新",
	"healthPage.ui.autoRefresh": "自动刷新",
	"healthPage.ui.toggleAutoRefreshAria": "切换健康状态自动刷新",
	"healthPage.ui.autoRefreshOff": "已关闭",
	"healthPage.ui.autoRefreshEvery": "每 {label}",
	"healthPage.ui.autoRefreshPaused": "已暂停 · {label}",
	"healthPage.ui.healthUnavailable": "健康状态暂不可用",
	"healthPage.ui.retrying": "正在重试...",
	"healthPage.ui.retryLoad": "重试加载健康状态",
	"healthPage.ui.node": "节点",
	"healthPage.ui.status": "状态",
	"healthPage.ui.memory": "内存",
	"healthPage.ui.disk": "磁盘",
	"healthPage.ui.uptime": "运行时间",
	"healthPage.ui.details": "详情",
	"healthPage.ui.collapse": "收起 ▲",
	"healthPage.ui.trend": "趋势 ▼",
	"healthPage.ui.trendHeading": "{name} — 过去 24h 趋势",

	// Repair: db
	"healthPage.repair.db.label": "检查数据库连接",
	"healthPage.repair.db.description": "数据库状态正常，可继续关注业务层告警。",
	"healthPage.repair.db.descriptionCritical": "优先确认数据库与环境变量是否正常，必要时重载服务并检查日志。",
	"healthPage.repair.db.action": "验证 DATABASE_URL、数据库进程和 Prisma 连接",

	// Repair: runtime
	"healthPage.repair.runtime.label": "确认运行目录",
	"healthPage.repair.runtime.description": "运行目录基线已就绪。",
	"healthPage.repair.runtime.descriptionWarning": "部署目录或缓存目录可能缺失，建议补齐并复查权限。",
	"healthPage.repair.runtime.action": "检查 storage / uploads / downloads / backups / logs / tmp",

	// Repair: services
	"healthPage.repair.services.label": "核对核心服务",
	"healthPage.repair.services.description": "核心服务在线，可继续检查业务功能。",
	"healthPage.repair.services.descriptionCritical": "优先确认 Next.js、SSH WS 与 Caddy 是否都在运行。",
	"healthPage.repair.services.action": "验证 vcontrolhub-next.service / vcontrolhub-ssh-ws.service / caddy.service",

	// Repair: git
	"healthPage.repair.git.label": "核对 GitHub 同步",
	"healthPage.repair.git.description": "本地提交与 origin/main 保持一致。",
	"healthPage.repair.git.descriptionWarning": "本地与远端可能不同步，建议确认最近推送是否完成。",
	"healthPage.repair.git.action": "比对本地 HEAD 与 origin/main",

	// Repair: audit
	"healthPage.repair.audit.label": "复查审计高风险动作",
	"healthPage.repair.audit.description": "可快速查看最近的命令执行、删除、权限和令牌操作。",
	"healthPage.repair.audit.descriptionCritical": "系统已经出现严重告警，建议结合审计页先锁定最近的高风险操作。",
	"healthPage.repair.audit.action": "查看 command.execute / storage.file_delete / api_token.create",
};

export const en: Record<string, string> = {
	"healthPage.title": "Node Health",
	"healthPage.description": "Collect SSH metrics in real time, persist historical trends, and integrate with alert rules.",
	"healthPage.serverCount": "Managed {count} nodes",
	"healthPage.noPermission": "Missing health monitoring permission",
	"healthPage.noPermissionHint": "You need the health:read permission to view node health details and historical metrics.",

	// Status labels
	"healthPage.status.healthy": "Healthy",
	"healthPage.status.warning": "Warning",
	"healthPage.status.critical": "Critical",
	"healthPage.status.offline": "Offline",
	"healthPage.status.unknown": "Unknown",

	// Summary cards
	"healthPage.summary.total": "Total Nodes",
	"healthPage.summary.online": "Online Healthy",
	"healthPage.summary.warning": "Performance Warnings",
	"healthPage.summary.critical": "Critical Alerts",
	"healthPage.summary.offline": "Offline/Disabled",

	// UI strings
	"healthPage.ui.selfCheck": "System Self-check",
	"healthPage.ui.collectingMetrics": "Collecting self-check metrics…",
	"healthPage.ui.repairSuggestions": "Repair Suggestions",
	"healthPage.ui.checksSummary": "{total} checks · {healthy} healthy · {warning} warnings · {critical} critical",
	"healthPage.ui.auditLog": "View Audit Log",
	"healthPage.ui.home": "Back Home",
	"healthPage.ui.suggestedAction": "Suggested action: ",
	"healthPage.ui.lastRefresh": "Last refresh",
	"healthPage.ui.overallCritical": "critical alerts present",
	"healthPage.ui.overallWarning": "warnings present",
	"healthPage.ui.overallHealthy": "overall healthy",
	"healthPage.ui.refreshAria": "Refresh health status",
	"healthPage.ui.refreshing": "Refreshing...",
	"healthPage.ui.refresh": "🔄 Refresh",
	"healthPage.ui.autoRefresh": "Auto refresh",
	"healthPage.ui.toggleAutoRefreshAria": "Toggle health auto refresh",
	"healthPage.ui.autoRefreshOff": "Off",
	"healthPage.ui.autoRefreshEvery": "Every {label}",
	"healthPage.ui.autoRefreshPaused": "Paused · {label}",
	"healthPage.ui.healthUnavailable": "Health status is temporarily unavailable",
	"healthPage.ui.retrying": "Retrying...",
	"healthPage.ui.retryLoad": "Retry loading health status",
	"healthPage.ui.node": "Node",
	"healthPage.ui.status": "Status",
	"healthPage.ui.memory": "Memory",
	"healthPage.ui.disk": "Disk",
	"healthPage.ui.uptime": "Uptime",
	"healthPage.ui.details": "Details",
	"healthPage.ui.collapse": "Collapse ▲",
	"healthPage.ui.trend": "Trend ▼",
	"healthPage.ui.trendHeading": "{name} — last 24h trend",

	// Repair: db
	"healthPage.repair.db.label": "Check database connection",
	"healthPage.repair.db.description": "Database checks are healthy; continue watching business-level alerts.",
	"healthPage.repair.db.descriptionCritical": "First confirm the database and environment variables, then reload services and inspect logs if needed.",
	"healthPage.repair.db.action": "Verify DATABASE_URL, database process, and Prisma connectivity",

	// Repair: runtime
	"healthPage.repair.runtime.label": "Confirm runtime directories",
	"healthPage.repair.runtime.description": "Runtime directory baseline is ready.",
	"healthPage.repair.runtime.descriptionWarning": "Deployment or cache directories may be missing; create them and recheck ownership.",
	"healthPage.repair.runtime.action": "Check storage / uploads / downloads / backups / logs / tmp",

	// Repair: services
	"healthPage.repair.services.label": "Verify core services",
	"healthPage.repair.services.description": "Core services are online; continue checking product workflows.",
	"healthPage.repair.services.descriptionCritical": "First confirm Next.js, SSH WS, and Caddy are all running.",
	"healthPage.repair.services.action": "Verify vcontrolhub-next.service / vcontrolhub-ssh-ws.service / caddy.service",

	// Repair: git
	"healthPage.repair.git.label": "Check GitHub sync",
	"healthPage.repair.git.description": "Local commits match origin/main.",
	"healthPage.repair.git.descriptionWarning": "Local and remote refs may differ; confirm the latest push completed.",
	"healthPage.repair.git.action": "Compare local HEAD with origin/main",

	// Repair: audit
	"healthPage.repair.audit.label": "Review high-risk audit actions",
	"healthPage.repair.audit.description": "Quickly inspect recent command execution, deletion, permission, and token actions.",
	"healthPage.repair.audit.descriptionCritical": "Critical alerts are present; use the audit page to identify recent high-risk operations first.",
	"healthPage.repair.audit.action": "Open command.execute / storage.file_delete / api_token.create",
};
