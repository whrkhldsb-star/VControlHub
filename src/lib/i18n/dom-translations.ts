import { type Locale } from "./translations";

type TextTranslation = string | ((match: RegExpMatchArray) => string);

type Rule = {
  pattern: RegExp;
  en: TextTranslation;
};

const exactTranslations: Record<string, string> = {

  "Alert Rules": "Alert Rules",
  "Remote Downloads": "Remote Downloads",
  "Files & Storage": "Files & Storage",
  "VPS Management": "VPS Management",
  "Approvals": "Approvals",
  "Audit": "Audit",
  "Notifications": "Notifications",
  "Users": "Users",
  "Snippets": "Snippets",
  "Settings": "Settings",
  "Command Templates": "Command Templates",
  "Scheduled Tasks": "Scheduled Tasks",
  "智能告警": "Alert Rules",
  "配置自动告警规则，异常指标自动触发通知与 Webhook": "Configure automated alert rules; abnormal metrics trigger notifications and webhooks.",
  "远程下载": "Remote Downloads",
  "输入 URL 或磁力链接，下载到指定 VPS 的存储路径": "Enter a URL or magnet link and download it to a target VPS storage path.",
  "文件与存储管理": "Files & Storage",
  "文件浏览、上传下载、存储节点管理一体化": "Browse files, upload and download, and manage storage nodes in one place.",
  "审计日志": "Audit Log",
  "平台操作追踪与安全审计": "Platform operation tracking and security auditing.",
  "通知中心": "Notifications",
  "所有通知已读": "All notifications read",
  "用户管理": "User Management",
  "创建用户、分配角色与权限管理": "Create users, assign roles, and manage permissions.",
  "查看用户、角色与权限（只读）": "View users, roles, and permissions (read-only).",
  "代码片段库": "Snippet Library",
  "沉淀常用脚本、命令和配置片段，支持语言、标签和私有片段。": "Save reusable scripts, commands, and configuration snippets with language, tags, and private snippets.",
  "定时任务": "Scheduled Tasks",
  "配置 Cron 表达式，自动向 VPS 节点下发待审批命令": "Configure Cron expressions to automatically dispatch approval-bound commands to VPS nodes.",
  "系统设置": "System Settings",
  "配置平台名称、安全策略、邮件通知等全局参数": "Configure global settings such as platform name, security policy, and email notifications.",
  "命令模板": "Command Templates",
  "预置与自定义运维命令模板，支持变量占位符一键下发": "Preset and custom operations command templates with variable placeholders for one-click dispatch.",
  "VPS 管理": "VPS Management",
  "聚焦 VPS 节点、SSH 密钥与直连网关维护；命令审批与投递记录统一进入审批中心。": "Manage VPS nodes, SSH keys, and Direct Gateway maintenance; command approvals and delivery logs are unified in Approvals.",
  "命令下发": "Dispatch command",
  "查看审计日志": "View audit log",
  "去部署面板": "Open deployment panel",
  "审批中心": "Approvals",
  "AI 助手授权与用户命令审批": "AI assistant authorization and user command approvals.",
  "当前支持两条审批链路": "Two approval flows are currently supported",
  "AI 助手托管操作先授权再执行；用户/运维提交的命令请求走命令审批流。": "AI-hosted operations require authorization before execution; user and operations command requests use the command approval flow.",
  "回到首页": "Back to home",
  "去系统自检": "Open health check",
  "文件节点": "Storage nodes",
  "活跃文件": "Active files",
  "当前目录": "Current directory",
  "系统自检": "System health",
  "服务器管理": "Server management",

  "回收站": "Recycle Bin",
  "全局文件检索": "Global file search",
  "跨本地和 SFTP 节点检索文件名，适合快速定位配置、日志和上传文件。": "Search filenames across local and SFTP nodes to quickly locate configs, logs, and uploaded files.",
  "打开全局检索": "Open global search",
  "当前目录检索": "Current directory search",
  "在当前路径内筛选文件名，适合编辑前先缩小范围。": "Filter filenames inside the current path before editing or narrowing scope.",
  "仅当前目录": "Current directory only",
  "查看最近删除的文件，做误删恢复前的快速核对。": "Review recently deleted files before restoring accidental deletions.",
  "进入回收站": "Open recycle bin",
  "存储节点": "Storage nodes",
  "按层级展开所有已登记目录，便于快速跳转。": "Expand registered directories by hierarchy for quick navigation.",
  "按节点筛选": "Filter by node",
  "当前：": "Current:",
  "全部节点": "All nodes",
  "选择存储节点": "Select storage node",
  "全部文件": "All files",
  "切换存储节点": "Switch storage node",
  "节点变多后可以先检索，再从下拉框切换到目标节点；列表会自动按 LOCAL 或 SFTP 节点类型执行浏览、上传、下载和文件操作。": "When there are many nodes, search first, then switch to the target node from the dropdown. The list automatically performs browsing, uploads, downloads, and file operations by LOCAL or SFTP node type.",
  "搜索节点名称、类型或 ID": "Search node name, type, or ID",
  "搜索文件名": "Search filename",
  "当前目录操作": "Current directory actions",
  "刷新列表": "Refresh list",
  "新建文件夹": "New folder",
  "列表": "List",
  "图标": "Grid",
  "打开": "Open",
  "你没有备份管理查看权限。": "You do not have permission to view backup management.",
  "备份与迁移": "Backups & Migration",
  "记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。恢复命令只展示，不会绕过审批直接执行。": "Record database, file, and full backups; use deploy/backup.sh and restore-db.sh to support migration to other systems. Restore commands are displayed only and do not bypass approval for direct execution.",
  "完成备份": "Completed backups",
  "已用备份空间": "Backup storage used",
  "保留策略提示": "Retention policy hints",
  "异常/执行中": "Failed / Running",
  "失败 / PENDING+RUNNING": "Failed / PENDING+RUNNING",
  "备份策略概览": "Backup policy overview",
  "按备份类型汇总数量和容量，辅助规划定时备份、异地备份与保留策略。": "Summarize count and capacity by backup type to help plan scheduled backups, offsite backups, and retention policies.",
  "创建并执行备份": "Create and queue backup",
  "提交后会创建可审计备份记录并排入 Durable Job 后台队列；页面可刷新查看 PENDING/RUNNING/COMPLETED 或 FAILED 状态。": "After submission, an auditable backup record is created and queued into the Durable Job background queue. Refresh the page to view PENDING, RUNNING, COMPLETED, or FAILED status.",
  "创建定时备份": "Create scheduled backup",
  "选择备份类型、Cron 与执行节点后，会创建一条可审计的定时任务；后续执行日志可在“定时任务”页面追踪。": "After choosing backup type, Cron, and execution nodes, an auditable scheduled task is created. Future execution logs can be tracked on the Scheduled Tasks page.",
  "备份记录": "Backup records",
  "暂无备份记录": "No backup records yet",
  "只有 COMPLETED 状态的备份可以执行恢复。": "Only COMPLETED backups can be restored.",
  "未知文件": "Unknown file",
  "← 返回文件": "← Back to files",
  "⬇ 下载": "⬇ Download",
  "此文件类型暂不支持在线预览": "This file type does not support online preview yet",
  "⬇ 下载后查看": "⬇ Download to view",
  "远端目录同步失败，已显示本地索引": "Remote directory sync failed; showing local index.",
  "执行恢复": "Run restore",
  "确认恢复备份": "Confirm backup restore",
  "确认恢复": "Confirm restore",
  "确认文本": "Confirmation text",
  "恢复已执行": "Restore executed",
  "请输入 5 段 Cron 表达式：分钟 小时 日期 月份 星期": "Enter a 5-field Cron expression: minute hour day month weekday",
  "每小时整点执行": "Run hourly on the hour",
  "自定义 Cron；保存后会进入定时任务调度队列": "Custom Cron; after saving it enters the scheduled task queue",
  "页面不存在或已被移除": "The page does not exist or has been removed",
  "← 返回首页": "← Back to home",
  "系统管理": "System",
  "退出登录": "Sign Out",
  "修改密码": "Change Password",
  "切换到英文": "Switch to English",
  "切换到浅色模式": "Switch to light mode",
  "切换到深色模式": "Switch to dark mode",
  "通知": "Notifications",
  "图床": "Image Bed",
  "VPS 管理与分布式云盘": "VPS Management & Distributed Cloud Drive",
  "共": "Total",
  "共 ": "Total ",
  "上传图片获取外链，支持拖拽上传和云盘联动": "Upload images to get public links, with drag-and-drop uploads and storage integration.",
  "张图片": "images",
  "全部用户": "All users",
  "统计": "Stats",
  "云盘发布": "Publish from storage",
  "批量模式": "Batch mode",
  "上传到：": "Upload to:",
  "默认存储": "Default storage",
  "加载节点": "Load nodes",
  "拖拽图片到此处，或点击选择文件": "Drop images here, or click to choose files",
  "支持 JPG / PNG / GIF / WebP / AVIF / SVG，单文件最大 20MB": "Supports JPG / PNG / GIF / WebP / AVIF / SVG; max 20MB per file",
  "目标路径（可选）": "Target path (optional)",
  "按相册筛选（可选）": "Filter by album (optional)",
  "搜索": "Search",
  "重置": "Reset",
  "暂无图片，上传第一张吧 🎉": "No images yet. Upload the first one 🎉",
  " 条记录": " records",
  "最大：": "Largest: ",
  "条完成备份超过 30 天，建议复核清理": "completed backups are older than 30 days; review cleanup is recommended",
  "最近完成：": "Latest completed: ",
  " 个 · ": " item(s) · ",
  "暂无": "None",
  "未完成": "Not completed",
  "待生成": "Pending generation",
};

const rules: Rule[] = [
  { pattern: /^共\s*(\d+)\s*条记录$/, en: (m) => `Total ${m[1]} records` },
  { pattern: /^最大：(.+)$/, en: (m) => `Largest: ${translateKnownFragments(m[1] ?? "")}` },
  { pattern: /^(\d+)\s*条完成备份超过 30 天，建议复核清理$/, en: (m) => `${m[1]} completed backups are older than 30 days; review cleanup is recommended` },
  { pattern: /^最近完成：(.+)$/, en: (m) => `Latest completed: ${translateKnownFragments(m[1] ?? "")}` },
  { pattern: /^(\d+)\s*个\s*·\s*(.+)$/, en: (m) => `${m[1]} item(s) · ${translateKnownFragments(m[2] ?? "")}` },
  { pattern: /^(\d+)\s*条$/, en: (m) => `${m[1]} records` },

  { pattern: /^(\d+)\s*条未读通知$/, en: (m) => `${m[1]} unread notification(s)` },
  { pattern: /^(\d+)\s*个节点\s*·\s*本机\s*(\d+)\s*·\s*SFTP\s*(\d+)$/, en: (m) => `${m[1]} nodes · Local ${m[2]} · SFTP ${m[3]}` },
  { pattern: /^当前路径：(.+)$/, en: (m) => `Current path: ${m[1]}` },
  { pattern: /^项目数\s*(\d+)$/, en: (m) => `${m[1]} items` },
  { pattern: /^(\d+)\s*项$/, en: (m) => `${m[1]} items` },
  { pattern: /^大小：(.+)$/, en: (m) => `Size: ${translateKnownFragments(m[1] ?? "")}` },
  { pattern: /^完成：(.+)$/, en: (m) => `Completed: ${translateKnownFragments(m[1] ?? "")}` },
  { pattern: /^错误：(.+)$/, en: (m) => `Error: ${m[1]}` },
  { pattern: /^文件较大（(.+) MB），预览可能较慢。建议直接下载后查看。$/, en: (m) => `Large file (${m[1]} MB); preview may be slow. Downloading it first is recommended.` },
  { pattern: /^每天 (.+) 执行$/, en: (m) => `Run daily at ${m[1]}` },
  { pattern: /^每周日 (.+) 执行$/, en: (m) => `Run every Sunday at ${m[1]}` },
  { pattern: /^每周一 (.+) 执行$/, en: (m) => `Run every Monday at ${m[1]}` },
  { pattern: /^每周二 (.+) 执行$/, en: (m) => `Run every Tuesday at ${m[1]}` },
  { pattern: /^每周三 (.+) 执行$/, en: (m) => `Run every Wednesday at ${m[1]}` },
  { pattern: /^每周四 (.+) 执行$/, en: (m) => `Run every Thursday at ${m[1]}` },
  { pattern: /^每周五 (.+) 执行$/, en: (m) => `Run every Friday at ${m[1]}` },
  { pattern: /^每周六 (.+) 执行$/, en: (m) => `Run every Saturday at ${m[1]}` },
];

const fragmentTranslationAllowList = new Set([
  "共 ",
  " 条记录",
  "最大：",
  "最近完成：",
  " 个 · ",
]);

function translateKnownFragments(text: string) {
  let partial = text;
  let changed = false;
  for (const [source, translated] of Object.entries(exactTranslations)) {
    if (!source || !partial.includes(source)) continue;
    const isShortCjkFragment = /[\u4e00-\u9fff]/.test(source) && source.replace(/\s/g, "").length <= 2;
    if (isShortCjkFragment && !fragmentTranslationAllowList.has(source)) continue;
    partial = partial.split(source).join(translated);
    changed = true;
  }
  return changed ? partial : text;
}

export function getDomTextTranslation(text: string, locale: Locale) {
  if (locale === "zh") return text;
  const exact = exactTranslations[text];
  if (exact) return exact;
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    return typeof rule.en === "function" ? rule.en(match) : rule.en;
  }
  return translateKnownFragments(text);
}

export function getDomTranslationCatalog() {
  return { exactTranslations, rules };
}
