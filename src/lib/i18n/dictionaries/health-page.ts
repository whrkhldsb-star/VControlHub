/**
 * i18n dictionary: `healthPage.*` (5 keys).
 *
 * Used by `src/app/health/page.tsx` (server component):
 *   - PageHeader title / description
 *   - permission-denied notice + hint
 *   - "managed nodes: N" badge (template)
 *
 * Mirrors the `qaReportsPage` server-component pattern: page.tsx imports
 * `t` from `@/lib/i18n/translations` and calls `t("healthPage.title")`,
 * with the default `zh` locale (the I18nProvider on the client handles
 * the live `zh` ↔ `en` switch via localStorage).
 */
export const zh: Record<string, string> = {
	"healthPage.title": "节点健康",
	"healthPage.description": "实时采集 SSH 指标、保存历史趋势，并与告警规则联动。",
	"healthPage.serverCount": "纳管节点 {count} 台",
	"healthPage.noPermission": "缺少健康监控权限",
	"healthPage.noPermissionHint": "需要 health:read 权限后才能查看节点健康详情和历史指标。",
};

export const en: Record<string, string> = {
	"healthPage.title": "Node Health",
	"healthPage.description": "Collect SSH metrics in real time, persist historical trends, and integrate with alert rules.",
	"healthPage.serverCount": "Managed {count} nodes",
	"healthPage.noPermission": "Missing health monitoring permission",
	"healthPage.noPermissionHint": "You need the health:read permission to view node health details and historical metrics.",
};
