/**
 * i18n dictionary: `aiOpsPage.*` (~50 keys).
 *
 * TR-032 E02: Smart AI ops UI copy — list of AI ops scan logs, the
 * detail panel (findings + recommended actions + executed actions), the
 * summary cards (counts by status / mode / last scan), and the manual
 * scan trigger + recommendation-execute buttons. The page surfaces
 * mode (recommendation / autonomous), trigger type (scheduled / manual /
 * recommendation_followup), and status (ok / warning / error / skipped
 * / running) — all keyed in zh+en so the UI can render the right
 * label without falling back to the raw enum literal.
 */

export const zh: Record<string, string> = {
	// Page header
	"aiOpsPage.title": "AI 智能运维",
	"aiOpsPage.eyebrow": "AI 运维",
	"aiOpsPage.desc":
		"AI 每日 02:00 自动扫描系统健康信号（告警规则 / 命令失败 / 工作流失败），给出诊断与处理建议。recommendation 模式需要人工审批，autonomous 模式只对白名单内的安全动作自动执行。",
	"aiOpsPage.summary.title": "扫描汇总",
	"aiOpsPage.summary.total": "总扫描次数",
	"aiOpsPage.summary.byStatus": "按状态分布",
	"aiOpsPage.summary.byMode": "按模式分布",
	"aiOpsPage.summary.lastScanAt": "最近一次扫描",
	"aiOpsPage.summary.lastErrorAt": "最近一次错误",
	"aiOpsPage.summary.never": "暂无",
	// Toolbar
	"aiOpsPage.actions.refresh": "刷新",
	"aiOpsPage.actions.triggerScan": "立即扫描",
	"aiOpsPage.actions.scanning": "扫描中…",
	"aiOpsPage.actions.saving": "保存中…",
	"aiOpsPage.actions.execute": "执行",
	"aiOpsPage.actions.forceAutonomous": "自主执行（需 autonomous 权限）",
	"aiOpsPage.actions.approve": "批准",
	"aiOpsPage.actions.empty": "暂无扫描记录",
	"aiOpsPage.actions.triggerFailed": "扫描触发失败",
	"aiOpsPage.actions.approvedReady": "已审批，可点击执行",
	"aiOpsPage.actions.approvalFailed": "审批失败",
	"aiOpsPage.actions.executeFailed": "执行推荐项失败",
	"aiOpsPage.actions.loadFailed": "加载 AI 运维记录失败",
	// Filters
	"aiOpsPage.filter.all": "全部",
	"aiOpsPage.filter.mode": "按模式筛选",
	"aiOpsPage.filter.status": "按状态筛选",
	"aiOpsPage.filter.triggerType": "按触发类型筛选",
	// Table
	"aiOpsPage.table.time": "时间",
	"aiOpsPage.table.mode": "模式",
	"aiOpsPage.table.trigger": "触发",
	"aiOpsPage.table.status": "状态",
	"aiOpsPage.table.findings": "诊断",
	"aiOpsPage.table.actions": "动作",
	"aiOpsPage.table.duration": "耗时",
	"aiOpsPage.table.viewDetail": "查看详情",
	// Mode labels
	"aiOpsPage.mode.recommendation": "建议模式",
	"aiOpsPage.mode.autonomous": "自主模式",
	// Trigger labels
	"aiOpsPage.trigger.scheduled": "定时",
	"aiOpsPage.trigger.manual": "手动",
	"aiOpsPage.trigger.recommendation_followup": "建议跟进",
	// Status labels
	"aiOpsPage.status.ok": "正常",
	"aiOpsPage.status.warning": "警告",
	"aiOpsPage.status.error": "失败",
	"aiOpsPage.status.skipped": "已跳过",
	"aiOpsPage.status.running": "运行中",
	// Severity labels
	"aiOpsPage.severity.info": "信息",
	"aiOpsPage.severity.warning": "警告",
	"aiOpsPage.severity.critical": "严重",
	// Risk labels
	"aiOpsPage.risk.low": "低风险",
	"aiOpsPage.risk.medium": "中风险",
	"aiOpsPage.risk.high": "高风险",
	// Detail panel
	"aiOpsPage.detail.title": "扫描详情",
	"aiOpsPage.detail.findings": "诊断",
	"aiOpsPage.detail.findingsEmpty": "无诊断",
	"aiOpsPage.detail.recommendedActions": "推荐动作",
	"aiOpsPage.detail.recommendedActionsEmpty": "无推荐动作",
	"aiOpsPage.detail.errorMessage": "错误信息",
	"aiOpsPage.detail.durationMs": "{ms} 毫秒",
	// Execute result messages
	"aiOpsPage.execute.requiresApproval": "需要管理员审批，不会自动执行",
	"aiOpsPage.execute.executed": "已执行",
	// Settings (placeholder — full settings UI is Tick 3)
	"aiOpsPage.settings.title": "AI 运维设置",
	"aiOpsPage.settings.mode": "运行模式",
	"aiOpsPage.settings.provider": "AI 提供方",
	"aiOpsPage.settings.notConfigured": "（使用默认 recommendation 模式）",
	"aiOpsPage.settings.saved": "设置已保存",
};

export const en: Record<string, string> = {
	// Page header
	"aiOpsPage.title": "AI Smart Ops",
	"aiOpsPage.eyebrow": "AI operations",
	"aiOpsPage.desc":
		"AI scans system-health signals (alert rules / command failures / playbook failures) every day at 02:00 and surfaces diagnostics and recommended actions. In recommendation mode every action needs admin approval; in autonomous mode only the safe-set whitelist is auto-executed.",
	"aiOpsPage.summary.title": "Scan summary",
	"aiOpsPage.summary.total": "Total scans",
	"aiOpsPage.summary.byStatus": "By status",
	"aiOpsPage.summary.byMode": "By mode",
	"aiOpsPage.summary.lastScanAt": "Last scan",
	"aiOpsPage.summary.lastErrorAt": "Last error",
	"aiOpsPage.summary.never": "Never",
	// Toolbar
	"aiOpsPage.actions.refresh": "Refresh",
	"aiOpsPage.actions.triggerScan": "Trigger scan",
	"aiOpsPage.actions.scanning": "Scanning…",
	"aiOpsPage.actions.saving": "Saving…",
	"aiOpsPage.actions.execute": "Execute",
	"aiOpsPage.actions.forceAutonomous": "Force autonomous (requires ai:ops:autonomous)",
	"aiOpsPage.actions.approve": "Approve",
	"aiOpsPage.actions.empty": "No scan records yet",
	"aiOpsPage.actions.triggerFailed": "Failed to trigger scan",
	"aiOpsPage.actions.approvedReady": "Approved, ready to execute",
	"aiOpsPage.actions.approvalFailed": "Approval failed",
	"aiOpsPage.actions.executeFailed": "Failed to execute recommendation",
	"aiOpsPage.actions.loadFailed": "Failed to load AI ops logs",
	// Filters
	"aiOpsPage.filter.all": "All",
	"aiOpsPage.filter.mode": "Filter by mode",
	"aiOpsPage.filter.status": "Filter by status",
	"aiOpsPage.filter.triggerType": "Filter by trigger type",
	// Table
	"aiOpsPage.table.time": "Time",
	"aiOpsPage.table.mode": "Mode",
	"aiOpsPage.table.trigger": "Trigger",
	"aiOpsPage.table.status": "Status",
	"aiOpsPage.table.findings": "Findings",
	"aiOpsPage.table.actions": "Actions",
	"aiOpsPage.table.duration": "Duration",
	"aiOpsPage.table.viewDetail": "View detail",
	// Mode labels
	"aiOpsPage.mode.recommendation": "Recommendation",
	"aiOpsPage.mode.autonomous": "Autonomous",
	// Trigger labels
	"aiOpsPage.trigger.scheduled": "Scheduled",
	"aiOpsPage.trigger.manual": "Manual",
	"aiOpsPage.trigger.recommendation_followup": "Follow-up",
	// Status labels
	"aiOpsPage.status.ok": "OK",
	"aiOpsPage.status.warning": "Warning",
	"aiOpsPage.status.error": "Error",
	"aiOpsPage.status.skipped": "Skipped",
	"aiOpsPage.status.running": "Running",
	// Severity labels
	"aiOpsPage.severity.info": "Info",
	"aiOpsPage.severity.warning": "Warning",
	"aiOpsPage.severity.critical": "Critical",
	// Risk labels
	"aiOpsPage.risk.low": "Low risk",
	"aiOpsPage.risk.medium": "Medium risk",
	"aiOpsPage.risk.high": "High risk",
	// Detail panel
	"aiOpsPage.detail.title": "Scan detail",
	"aiOpsPage.detail.findings": "Findings",
	"aiOpsPage.detail.findingsEmpty": "No findings",
	"aiOpsPage.detail.recommendedActions": "Recommended actions",
	"aiOpsPage.detail.recommendedActionsEmpty": "No recommended actions",
	"aiOpsPage.detail.errorMessage": "Error message",
	"aiOpsPage.detail.durationMs": "{ms} ms",
	// Execute result messages
	"aiOpsPage.execute.requiresApproval": "Requires admin approval; will not auto-execute",
	"aiOpsPage.execute.executed": "Executed",
	// Settings (placeholder — full settings UI is Tick 3)
	"aiOpsPage.settings.title": "AI ops settings",
	"aiOpsPage.settings.mode": "Operating mode",
	"aiOpsPage.settings.provider": "AI provider",
	"aiOpsPage.settings.notConfigured": "(using default recommendation mode)",
	"aiOpsPage.settings.saved": "Settings saved",
};
