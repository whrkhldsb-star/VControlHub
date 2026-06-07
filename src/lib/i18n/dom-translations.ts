import { type Locale } from "./translations";

type TextTranslation = string | ((match: RegExpMatchArray) => string);

type Rule = {
  pattern: RegExp;
  en: TextTranslation;
};

const exactTranslations: Record<string, string> = {
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
  "创建并执行备份": "Create and run backup",
  "提交后会立即在服务器执行对应的 deploy/backup.sh 模式，记录会从 RUNNING 更新为 COMPLETED 或 FAILED。": "After submission, the corresponding deploy/backup.sh mode runs immediately on the server. The record updates from RUNNING to COMPLETED or FAILED.",
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
  "共 ": "Total ",
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

function translateKnownFragments(text: string) {
  let partial = text;
  let changed = false;
  for (const [source, translated] of Object.entries(exactTranslations)) {
    if (!source || !partial.includes(source)) continue;
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
