/**
 * i18n dictionary: `deploymentsPage.launch.*` (19 keys).
 */

export const zh: Record<string, string> = {
	"deploymentsPage.launch.title": "新建部署任务",
	"deploymentsPage.launch.desc": "从代码仓库或镜像拉取，启动应用容器。",
	"deploymentsPage.launch.source.repo": "Git 仓库",
	"deploymentsPage.launch.source.image": "Docker 镜像",
	"deploymentsPage.launch.source.local": "本地上传",
	"deploymentsPage.launch.repoUrl": "仓库地址",
	"deploymentsPage.launch.repoUrlPlaceholder": "https://github.com/user/repo.git",
	"deploymentsPage.launch.branch": "分支",
	"deploymentsPage.launch.branchPlaceholder": "main",
	"deploymentsPage.launch.image": "镜像",
	"deploymentsPage.launch.imagePlaceholder": "nginx:latest",
	"deploymentsPage.launch.targetServer": "目标服务器",
	"deploymentsPage.launch.targetServerPlaceholder": "选择服务器",
	"deploymentsPage.launch.env": "环境变量",
	"deploymentsPage.launch.envPlaceholder": "KEY=VALUE, 每行一个",
	"deploymentsPage.launch.submit": "创建并部署",
	"deploymentsPage.launch.submitting": "部署中…",
	"deploymentsPage.launch.success": "部署任务已创建",
	"deploymentsPage.launch.errorFallback": "部署失败",
	"deploymentsPage.launch.addVps": "去添加 VPS",

	"deploymentsPage.launch.noServerSelected": "请至少选择一个目标 VPS",

	"deploymentsPage.launch.noTemplate": "请选择部署模板",

	"deploymentsPage.launch.noTemplateHint": "没有可用模板；请先在命令模板中心创建。",

	"deploymentsPage.launch.noVariables": "该模板没有变量，可直接选择目标 VPS 提交。",

	"deploymentsPage.launch.noVpsDesc": "暂无可用 VPS，不能发起部署。",

	"deploymentsPage.launch.noVpsTitle": "暂无可用 VPS",

	"deploymentsPage.launch.previewCommand": "预览命令",

	"deploymentsPage.launch.reasonPlaceholder": "例如：版本升级",

	"deploymentsPage.launch.targetVpsHint": "默认使用网站服务器中转；勾选后会通过 SSH 安装 VControlHub Direct Gateway 微服务。",

	"deploymentsPage.launch.targetVpsTitle": "目标 VPS",

	"deploymentsPage.launch.variablesHint": "下发前请填入实际值",

	"deploymentsPage.launch.variablesTitle": "模板变量",

};

export const en: Record<string, string> = {
	"deploymentsPage.launch.title": "New deployment",
	"deploymentsPage.launch.desc": "Pull from a Git repo or image, then start the app container.",
	"deploymentsPage.launch.source.repo": "Git repository",
	"deploymentsPage.launch.source.image": "Docker image",
	"deploymentsPage.launch.source.local": "Local upload",
	"deploymentsPage.launch.repoUrl": "Repository URL",
	"deploymentsPage.launch.repoUrlPlaceholder": "https://github.com/user/repo.git",
	"deploymentsPage.launch.branch": "Branch",
	"deploymentsPage.launch.branchPlaceholder": "main",
	"deploymentsPage.launch.image": "Image",
	"deploymentsPage.launch.imagePlaceholder": "nginx:latest",
	"deploymentsPage.launch.targetServer": "Target server",
	"deploymentsPage.launch.targetServerPlaceholder": "Select a server",
	"deploymentsPage.launch.env": "Environment variables",
	"deploymentsPage.launch.envPlaceholder": "KEY=VALUE, one per line",
	"deploymentsPage.launch.submit": "Create and deploy",
	"deploymentsPage.launch.submitting": "Deploying…",
	"deploymentsPage.launch.success": "Deployment task created",
	"deploymentsPage.launch.errorFallback": "Deployment failed",
	"deploymentsPage.launch.addVps": "Add VPS",

	"deploymentsPage.launch.noServerSelected": "Please select at least one target VPS",

	"deploymentsPage.launch.noTemplate": "Please select a deployment template",

	"deploymentsPage.launch.noTemplateHint": "No templates available; create one in the command template center first.",

	"deploymentsPage.launch.noVariables": "This template has no variables; pick a target VPS and submit directly.",

	"deploymentsPage.launch.noVpsDesc": "No available VPS; cannot launch deployment",

	"deploymentsPage.launch.noVpsTitle": "No available VPS",

	"deploymentsPage.launch.previewCommand": "Preview command",

	"deploymentsPage.launch.reasonPlaceholder": "e.g. Version upgrade",

	"deploymentsPage.launch.targetVpsHint": "By default the web server relays traffic; when enabled, VControlHub Direct Gateway microservice will be installed via SSH.",

	"deploymentsPage.launch.targetVpsTitle": "Target VPS",

	"deploymentsPage.launch.variablesHint": "Fill in actual values before dispatching",

	"deploymentsPage.launch.variablesTitle": "Template variables",

};
