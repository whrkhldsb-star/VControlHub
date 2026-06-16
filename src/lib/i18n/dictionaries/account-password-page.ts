/**
 * i18n dictionary: `accountPasswordPage.*` (12 keys).
 *
 * Used by:
 *   - src/app/account/password/page.tsx (server component)
 *   - src/app/account/password/change-password-form.tsx (client component)
 *
 * Server-component pattern (page.tsx):
 *   - `import { t } from "@/lib/i18n/translations"`
 *   - Call `t("accountPasswordPage.title")` etc. — default `zh` locale.
 *
 * Client-component pattern (change-password-form.tsx):
 *   - `useI18n()` hook (React context) — `t("accountPasswordPage.fields.currentLabel")`.
 *   - Tests use `renderWithI18n as render` from `@/lib/i18n/__tests__/test-helpers`.
 *
 * Template strings use `{seconds}` placeholders consumed via
 * `t("accountPasswordPage.redirectCountdown").replace("{seconds}", value)`.
 */
export const zh: Record<string, string> = {
	// page.tsx (RSC)
	"accountPasswordPage.title": "修改密码",
	"accountPasswordPage.description": "修改当前账号的后台登录密码",
	"accountPasswordPage.securityTips": "安全建议",
	"accountPasswordPage.tip1": "• 新密码建议使用 12 位以上，并混合大小写字母、数字与符号。",
	"accountPasswordPage.tip2": "• 修改成功后，现有会话不会立即失效；下次登录会使用新密码。",
	"accountPasswordPage.tip3": "• 若多人共用管理员账号，建议后续补独立用户与角色分配，而不是长期共用默认管理员。",

	// change-password-form.tsx (client)
	"accountPasswordPage.formDescription":
		"输入当前密码后设置新密码。修改后不会强制退出，但下次登录需使用新密码。",
	"accountPasswordPage.fields.currentLabel": "当前密码",
	"accountPasswordPage.fields.currentPlaceholder": "请输入当前密码",
	"accountPasswordPage.fields.newLabel": "新密码",
	"accountPasswordPage.fields.newPlaceholder": "至少 8 位",
	"accountPasswordPage.fields.confirmLabel": "确认新密码",
	"accountPasswordPage.fields.confirmPlaceholder": "再次输入新密码",

	// visibility toggle + submit pending
	"accountPasswordPage.toggle.show": "显示",
	"accountPasswordPage.toggle.hide": "隐藏",
	"accountPasswordPage.toggle.ariaShow": "显示 {label}",
	"accountPasswordPage.toggle.ariaHide": "隐藏 {label}",
	"accountPasswordPage.saving": "保存中...",

	// post-success redirect (countdown template + immediate button)
	"accountPasswordPage.redirectCountdown": "（{seconds}s 后自动跳到仪表盘…）",
	"accountPasswordPage.redirectNow": "立即跳到仪表盘",
};

export const en: Record<string, string> = {
	// page.tsx (RSC)
	"accountPasswordPage.title": "Change password",
	"accountPasswordPage.description": "Change the backend sign-in password for this account",
	"accountPasswordPage.securityTips": "Security recommendations",
	"accountPasswordPage.tip1":
		"• Use a password of at least 12 characters and mix upper/lower-case letters, digits, and symbols.",
	"accountPasswordPage.tip2":
		"• Existing sessions will not be terminated immediately; the new password is required at next sign-in.",
	"accountPasswordPage.tip3":
		"• If multiple people share the admin account, add per-user accounts with role assignments instead of long-term shared default admin access.",

	// change-password-form.tsx (client)
	"accountPasswordPage.formDescription":
		"Enter your current password to set a new one. Existing sessions will not be terminated, but the new password will be required at next sign-in.",
	"accountPasswordPage.fields.currentLabel": "Current password",
	"accountPasswordPage.fields.currentPlaceholder": "Enter current password",
	"accountPasswordPage.fields.newLabel": "New password",
	"accountPasswordPage.fields.newPlaceholder": "At least 8 characters",
	"accountPasswordPage.fields.confirmLabel": "Confirm new password",
	"accountPasswordPage.fields.confirmPlaceholder": "Re-enter new password",

	// visibility toggle + submit pending
	"accountPasswordPage.toggle.show": "Show",
	"accountPasswordPage.toggle.hide": "Hide",
	"accountPasswordPage.toggle.ariaShow": "Show {label}",
	"accountPasswordPage.toggle.ariaHide": "Hide {label}",
	"accountPasswordPage.saving": "Saving...",

	// post-success redirect (countdown template + immediate button)
	"accountPasswordPage.redirectCountdown": "({seconds}s until redirect to dashboard...)",
	"accountPasswordPage.redirectNow": "Go to dashboard now",
};
