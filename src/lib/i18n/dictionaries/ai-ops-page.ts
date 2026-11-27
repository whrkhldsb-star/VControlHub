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
		"每日 02:00 自动巡检告警、命令失败与工作流异常，并生成诊断与处理建议。建议模式下每项操作都需人工批准；自主模式仅自动执行预设的安全低风险动作。",
	"aiOpsPage.guide.title": "智能运维工作流程",
	"aiOpsPage.guide.summary": "按“巡检 → 诊断建议 → 批准 → 执行”顺序处理平台异常。",
	"aiOpsPage.guide.step1": "可选在下方绑定一个 AI 提供商以生成深度分析；未配置时也会执行内置健康规则巡检。",
	"aiOpsPage.guide.step2": "点击右上角“立即扫描”或等待每日 02:00 自动扫描，在历史列表中选中记录查看诊断结果。",
	"aiOpsPage.guide.step3": "建议模式下先点“批准”再点“执行”；日常交互式提问请前往“AI 助手”。",
	"aiOpsPage.guide.linkAi": "配置 AI 提供商",
	"aiOpsPage.guide.linkAlerts": "查看告警规则",
	"aiOpsPage.guide.linkPlaybooks": "查看 Playbook",
	"aiOpsPage.summary.title": "扫描汇总",
	"aiOpsPage.summary.total": "总扫描次数",
	"aiOpsPage.summary.byStatus": "按状态分布",
	"aiOpsPage.summary.byMode": "按模式分布",
	"aiOpsPage.summary.lastScanAt": "最近一次扫描",
	"aiOpsPage.summary.lastErrorAt": "最近一次错误",
	"aiOpsPage.summary.never": "暂无",
	"aiOpsPage.summary.noRate": "暂无数据",
	"aiOpsPage.summary.providerSuccessRate": "提供商成功率（最近 200 次扫描）",
	"aiOpsPage.summary.providerLastSuccess": "最近成功分析",
	"aiOpsPage.summary.providerRetryAt": "自动分析下次尝试",
	// Toolbar
	"aiOpsPage.actions.refresh": "刷新",
	"aiOpsPage.actions.triggerScan": "立即扫描",
	"aiOpsPage.actions.scanQueued": "扫描已加入队列，由后台执行，完成后列表会更新",
	"aiOpsPage.actions.scanning": "扫描中…",
	"aiOpsPage.actions.saving": "保存中…",
	"aiOpsPage.actions.execute": "执行",
	"aiOpsPage.actions.forceAutonomous": "自主执行（需要自主运维权限）",
	"aiOpsPage.actions.approve": "批准",
	"aiOpsPage.actions.empty": "暂无扫描记录",
	"aiOpsPage.actions.emptyFiltered": "没有符合筛选条件的扫描记录",
	"aiOpsPage.actions.emptyHint": "每天 02:00 自动扫描一次，也可以现在扫描。",
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
	"aiOpsPage.table.title": "扫描记录",
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
	"aiOpsPage.settings.modeHint": "建议模式只给出操作方案，需人工批准后再执行；自主模式仅自动执行预设的安全低风险动作。",
	"aiOpsPage.settings.configureProvider": "前往 AI 助手添加提供商",
	"aiOpsPage.settings.provider": "AI 提供商",
	"aiOpsPage.settings.notConfigured": "未配置（扫描只用内置检查）",
	"aiOpsPage.settings.providerOfOther": "{name}（由其他管理员配置）",
	"aiOpsPage.settings.providerUnavailable": "{id}（已停用或已删除，扫描只用内置检查）",
	"aiOpsPage.settings.reauthorize": "重新授权此 AI 提供方",
	"aiOpsPage.settings.save": "保存",
	"aiOpsPage.settings.saved": "设置已保存",
	"aiOpsPage.settings.saveFailed": "保存设置失败",
};

export const en: Record<string, string> = {
	// Page header
	"aiOpsPage.title": "AI ops",
	"aiOpsPage.eyebrow": "AI operations",
	"aiOpsPage.desc":
		"Scans alerts, failed commands, and playbook errors daily at 02:00 and proposes diagnostics and next steps. Recommendation mode requires approval for every action; autonomous mode auto-runs only approved low-risk actions.",
	"aiOpsPage.guide.title": "How AI ops works",
	"aiOpsPage.guide.summary": "Follows a four-step loop: scan, review findings, approve, then execute.",
	"aiOpsPage.guide.step1": "Optionally pick an AI provider below for deeper analysis; built-in health checks still run without one.",
	"aiOpsPage.guide.step2": "Click Trigger scan (or wait for the daily 02:00 run) and select a row in Scan history to inspect findings.",
	"aiOpsPage.guide.step3": "In recommendation mode, click Approve and then Execute. For interactive chat, use AI assistant.",
	"aiOpsPage.guide.linkAi": "Configure AI provider",
	"aiOpsPage.guide.linkAlerts": "Open alert rules",
	"aiOpsPage.guide.linkPlaybooks": "Open playbooks",
	"aiOpsPage.summary.title": "Scan summary",
	"aiOpsPage.summary.total": "Total scans",
	"aiOpsPage.summary.byStatus": "By status",
	"aiOpsPage.summary.byMode": "By mode",
	"aiOpsPage.summary.lastScanAt": "Last scan",
	"aiOpsPage.summary.lastErrorAt": "Last error",
	"aiOpsPage.summary.never": "Never",
	"aiOpsPage.summary.noRate": "No data yet",
	"aiOpsPage.summary.providerSuccessRate": "Provider success rate (latest 200 scans)",
	"aiOpsPage.summary.providerLastSuccess": "Last successful analysis",
	"aiOpsPage.summary.providerRetryAt": "Next automatic analysis attempt",
	// Toolbar
	"aiOpsPage.actions.refresh": "Refresh",
	"aiOpsPage.actions.triggerScan": "Trigger scan",
	"aiOpsPage.actions.scanQueued": "Scan queued; the worker runs it and the list updates when it is done",
	"aiOpsPage.actions.scanning": "Scanning…",
	"aiOpsPage.actions.saving": "Saving…",
	"aiOpsPage.actions.execute": "Execute",
	"aiOpsPage.actions.forceAutonomous": "Run autonomously (requires autonomous ops permission)",
	"aiOpsPage.actions.approve": "Approve",
	"aiOpsPage.actions.empty": "No scan records yet",
	"aiOpsPage.actions.emptyFiltered": "No scans match these filters",
	"aiOpsPage.actions.emptyHint": "A scan runs every day at 02:00, and you can run one now.",
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
	"aiOpsPage.table.title": "Scan history",
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
	"aiOpsPage.settings.modeHint": "Recommendation mode proposes actions for manual approval. Autonomous mode auto-runs only preset safe actions.",
	"aiOpsPage.settings.configureProvider": "Add a provider in AI assistant",
	"aiOpsPage.settings.provider": "AI provider",
	"aiOpsPage.settings.notConfigured": "Not configured (scans run the built-in checks only)",
	"aiOpsPage.settings.providerOfOther": "{name} (chosen by another administrator)",
	"aiOpsPage.settings.providerUnavailable": "{id} (disabled or deleted; scans run the built-in checks only)",
	"aiOpsPage.settings.reauthorize": "Reauthorize this AI provider",
	"aiOpsPage.settings.save": "Save",
	"aiOpsPage.settings.saved": "Settings saved",
	"aiOpsPage.settings.saveFailed": "Failed to save settings",
};
