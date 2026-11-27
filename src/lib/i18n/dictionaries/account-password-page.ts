/**
 * i18n dictionary: `accountPasswordPage.*` (9 keys).
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
 * `t("accountPasswordPage.redirectCountdown", { seconds: value })`.
 */
export const zh: Record<string, string> = {
	// page.tsx (RSC)
	"accountPasswordPage.title": "修改密码",
	"accountPasswordPage.eyebrow": "账户",
	"accountPasswordPage.description": "修改当前账号的登录密码。两步验证和登录会话在账户安全页面管理。",
	"accountPasswordPage.securityTips": "安全建议",
	"accountPasswordPage.tip1": "新密码建议使用 12 位以上，并混合大小写字母、数字与符号。",
	"accountPasswordPage.tip2": "修改成功后，现有会话不会立即失效；如需让其他设备退出，请在账户安全页面使用“退出所有设备”。",
	"accountPasswordPage.tip3": "若多人共用管理员账号，建议在用户管理中为每个人创建独立账号并分配角色，而不是长期共用默认管理员。",
	"accountPasswordPage.link.security": "账户安全",
	"accountPasswordPage.link.users": "用户管理",

	// change-password-form.tsx (client)
	"accountPasswordPage.formDescription":
		"输入当前密码后设置新密码。修改后不会强制退出，但下次登录需使用新密码。",

	// post-success redirect (countdown template + immediate button)
	"accountPasswordPage.redirectCountdown": "（{seconds}s 后自动跳到仪表盘…）",
	"accountPasswordPage.redirectNow": "立即跳到仪表盘",
	"accountPasswordPage.action.success": "密码已更新。下次登录请使用新密码。",
	"accountPasswordPage.action.errorFallback": "修改密码失败",
	"accountPasswordPage.action.invalidInput": "新密码需为 8–128 位，且当前密码不能为空",
	"accountPasswordPage.action.mismatch": "两次输入的新密码不一致",
	"accountPasswordPage.action.tooManyAttempts": "尝试次数过多，请 15 分钟后再试",
};

export const en: Record<string, string> = {
	// page.tsx (RSC)
	"accountPasswordPage.title": "Change password",
	"accountPasswordPage.eyebrow": "Account",
	"accountPasswordPage.description": "Change the sign-in password for this account. Two-factor and signed-in sessions are on the account security page.",
	"accountPasswordPage.securityTips": "Security recommendations",
	"accountPasswordPage.tip1":
		"Use a password of at least 12 characters and mix upper/lower-case letters, digits, and symbols.",
	"accountPasswordPage.tip2":
		"Existing sessions are not ended right away; to sign out other devices, use “Sign out of all devices” on the account security page.",
	"accountPasswordPage.tip3":
		"If several people share the admin account, create a separate account for each of them under Users and assign roles, instead of sharing the default admin.",
	"accountPasswordPage.link.security": "Account security",
	"accountPasswordPage.link.users": "Users",

	// change-password-form.tsx (client)
	"accountPasswordPage.formDescription":
		"Enter your current password to set a new one. Existing sessions will not be terminated, but the new password will be required at next sign-in.",

	// post-success redirect (countdown template + immediate button)
	"accountPasswordPage.redirectCountdown": "({seconds}s until redirect to dashboard…)",
	"accountPasswordPage.redirectNow": "Go to dashboard now",
	"accountPasswordPage.action.success": "Password updated. Use the new password next time you sign in.",
	"accountPasswordPage.action.errorFallback": "Failed to change password",
	"accountPasswordPage.action.invalidInput": "The new password must be 8–128 characters, and the current password is required",
	"accountPasswordPage.action.mismatch": "The two new passwords do not match",
	"accountPasswordPage.action.tooManyAttempts": "Too many attempts — try again in 15 minutes",
};
