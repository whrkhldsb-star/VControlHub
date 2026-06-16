/**
 * i18n dictionary: `qsPage.*` — Quick Services page (R10G.13).
 * Covers quick-service-card / install-dialog / pending-uninstall-dialog /
 * pending-source-delete-dialog / page.tsx.
 */
export const zh: Record<string, string> = {
	// quick-service-card
	"qsPage.statusAvailable": "未安装",
	"qsPage.statusInstalling": "安装中…",
	"qsPage.statusRunning": "运行中",
	"qsPage.statusStopped": "已停止",
	"qsPage.statusError": "异常",
	"qsPage.portLabel": "端口 {port}",
	"qsPage.pathLabel": "路径 {path}",
	"qsPage.monthlyPulls": "📈 {pulls}k 拉取",
	"qsPage.installingLabel": "安装中…",
	"qsPage.installNow": "一键安装",
	"qsPage.accessAria": "访问 {name}（{label}）",
	"qsPage.access": "访问",
	"qsPage.busy": "…",
	"qsPage.stop": "停止",
	"qsPage.start": "启动",
	"qsPage.pullingImage": "正在拉取镜像…",
	"qsPage.refreshStatus": "刷新状态",
	"qsPage.update": "更新",
	"qsPage.uninstall": "卸载",

	// install-dialog
	"qsPage.checkFailed": "检查失败",
	"qsPage.installTitle": "安装 {name}",
	"qsPage.installSubtitle": "选择服务监听的端口，安装后可通过该端口访问服务。",
	"qsPage.portNumberLabel": "端口号",
	"qsPage.portAvailable": "✓ 可用",
	"qsPage.portInUse": "✗ 占用",
	"qsPage.portInUseDetail": "端口被占用：{usedBy}",
	"qsPage.configPreviewTitle": "安装前配置预览",
	"qsPage.imageLabel": "镜像：{image}",
	"qsPage.imagePending": "待刷新",
	"qsPage.containerPortLabel": "容器端口：{container} → 宿主端口 {host}",
	"qsPage.containerPortDash": "-",
	"qsPage.envVarsLabel": "环境变量：{count} 个键（不展示密钥值）",
	"qsPage.volumesLabel": "宿主机挂载：{count} 条",
	"qsPage.recommendedPort": "推荐端口: {port}",
	"qsPage.autoAssign": "自动分配",
	"qsPage.cancel": "取消",
	"qsPage.confirmInstall": "确认安装",

	// pending-uninstall-dialog
	"qsPage.uninstallAria": "确认卸载快捷服务",
	"qsPage.uninstallTitle": "确认卸载快捷服务",
	"qsPage.uninstallBody": "将卸载 {name}，容器将被删除。默认保留宿主机数据目录，方便重新安装后继续使用。",
	"qsPage.alsoDeleteData": "同时删除数据目录",
	"qsPage.dataDeleteHint": "仅删除该服务模板记录的 `/opt/` 或 `/srv/` 下挂载目录；不会删除 Docker socket、时区文件或根目录。",
	"qsPage.confirmUninstall": "确认卸载",

	// pending-source-delete-dialog
	"qsPage.deleteSourceAria": "确认删除应用源",
	"qsPage.deleteSourceTitle": "确认删除应用源",
	"qsPage.deleteSourceBody": "将删除 {name}，其同步来的所有应用数据也会一并移除。",
	"qsPage.confirmDelete": "确认删除",

	// page header
	"qsPage.deployPanelLink": "部署面板",
	"qsPage.dockerLink": "Docker 容器",
	"qsPage.filesLink": "文件管理",
};

export const en: Record<string, string> = {
	// quick-service-card
	"qsPage.statusAvailable": "Not installed",
	"qsPage.statusInstalling": "Installing…",
	"qsPage.statusRunning": "Running",
	"qsPage.statusStopped": "Stopped",
	"qsPage.statusError": "Error",
	"qsPage.portLabel": "Port {port}",
	"qsPage.pathLabel": "Path {path}",
	"qsPage.monthlyPulls": "📈 {pulls}k pulls",
	"qsPage.installingLabel": "Installing…",
	"qsPage.installNow": "Install",
	"qsPage.accessAria": "Open {name} ({label})",
	"qsPage.access": "Open",
	"qsPage.busy": "…",
	"qsPage.stop": "Stop",
	"qsPage.start": "Start",
	"qsPage.pullingImage": "Pulling image…",
	"qsPage.refreshStatus": "Refresh status",
	"qsPage.update": "Update",
	"qsPage.uninstall": "Uninstall",

	// install-dialog
	"qsPage.checkFailed": "Check failed",
	"qsPage.installTitle": "Install {name}",
	"qsPage.installSubtitle": "Choose a host port for the service. After install, the service is reachable on that port.",
	"qsPage.portNumberLabel": "Port",
	"qsPage.portAvailable": "✓ Available",
	"qsPage.portInUse": "✗ In use",
	"qsPage.portInUseDetail": "Port in use: {usedBy}",
	"qsPage.configPreviewTitle": "Pre-install config preview",
	"qsPage.imageLabel": "Image: {image}",
	"qsPage.imagePending": "Pending refresh",
	"qsPage.containerPortLabel": "Container: {container} → Host {host}",
	"qsPage.containerPortDash": "-",
	"qsPage.envVarsLabel": "Env vars: {count} keys (values hidden)",
	"qsPage.volumesLabel": "Host mounts: {count}",
	"qsPage.recommendedPort": "Recommended port: {port}",
	"qsPage.autoAssign": "Auto-assign",
	"qsPage.cancel": "Cancel",
	"qsPage.confirmInstall": "Confirm install",

	// pending-uninstall-dialog
	"qsPage.uninstallAria": "Confirm uninstall",
	"qsPage.uninstallTitle": "Confirm uninstall",
	"qsPage.uninstallBody": "{name} will be uninstalled; the container will be removed. Host data directories are kept by default so you can reuse them on reinstall.",
	"qsPage.alsoDeleteData": "Also delete data directory",
	"qsPage.dataDeleteHint": "Only `/opt/` or `/srv/` mounts tracked for this template will be removed. Docker socket, timezone files, and root are not touched.",
	"qsPage.confirmUninstall": "Confirm uninstall",

	// pending-source-delete-dialog
	"qsPage.deleteSourceAria": "Confirm delete source",
	"qsPage.deleteSourceTitle": "Confirm delete source",
	"qsPage.deleteSourceBody": "{name} will be removed along with all apps it synced.",
	"qsPage.confirmDelete": "Confirm delete",

	// page header
	"qsPage.deployPanelLink": "Deployments",
	"qsPage.dockerLink": "Docker containers",
	"qsPage.filesLink": "File manager",
};
