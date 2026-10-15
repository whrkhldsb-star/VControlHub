import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettingsMasked, getSettingUpdateMetadata } from "@/lib/settings/service";
import { getRuntimeSettingSummaries } from "@/lib/runtime-settings/service";
import { getAvailableDefaultPageOptions } from "@/lib/preferences/user-preferences";
import { isPlatformAdmin as checkPlatformAdmin } from "@/lib/system/platform-admin";

import { UnifiedSettingsPageClient } from "./unified-settings-page-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

const SETTINGS_AUDIT_KEYS = [
	"platform.name",
	"platform.logo",
	"session.timeout",
	"password.minLength",
	"password.requireUppercase",
	"password.requireNumber",
	"password.requireSpecial",
	"runtime.commandExecutionTimeoutMs",
	"runtime.commandOutputLimitBytes",
	"runtime.commandStaleRunningAfterMs",
	"runtime.commandExecutionHeartbeatMs",
	"runtime.commandReconcileIntervalMs",
	"runtime.sftpSyncDirectoryTimeoutMs",
	"runtime.sshWsHeartbeatIntervalMs",
	"runtime.sshIdleTimeoutSec",
	"runtime.operationTaskListLimit",
	"runtime.aiProviderListLimit",
	"runtime.aiConversationListLimit",
	"smtp.enabled",
	"smtp.host",
	"smtp.port",
	"smtp.user",
	"smtp.pass",
	"smtp.from",
	"smtp.alertRecipients",
	// TR-009 55d: Telegram alert channel (settings UI + health self-check)
	"telegram.enabled",
	"telegram.botToken",
	"telegram.chatId",
];

export default async function SettingsPage() {
	const session = await requireSession("/settings");
	const canManage = sessionHasPermission(session, "user:manage");
	// Config import, cross-team export and secret-bearing export are reserved for
	// the built-in admin role — `user:manage` can also arrive as a direct grant,
	// and the API refuses those callers (see lib/system/platform-admin.ts).
	const isPlatformAdmin = checkPlatformAdmin(session);
	const defaultPageOptions = getAvailableDefaultPageOptions((permission) =>
		sessionHasPermission(session, permission),
	);

	const [settings, runtimeSettings, settingUpdateMetadata] = canManage
		? await Promise.all([
			// Masked read: sensitive values (smtp.pass, telegram.botToken, …)
			// must not ship to the browser in the SSR payload. The save path
			// keeps a secret sent back as the "***" sentinel (see /api/settings PATCH).
			getAllSettingsMasked(),
			getRuntimeSettingSummaries(),
			getSettingUpdateMetadata(SETTINGS_AUDIT_KEYS),
		])
		: [{}, [], {}];
	// Show each runtime knob's effective value: without a database row that is
	// the environment variable (or the built-in default), not the default alone.
	const effectiveSettings: Record<string, string> = { ...settings };
	for (const summary of runtimeSettings) {
		if (summary.source !== "database") effectiveSettings[summary.key] = String(summary.value);
	}
	return (
		<PageShell>
			<UnifiedSettingsPageClient
				settings={effectiveSettings}
				runtimeSettings={runtimeSettings}
				settingUpdateMetadata={settingUpdateMetadata}
				canManage={canManage}
				isPlatformAdmin={isPlatformAdmin}
				defaultPageOptions={defaultPageOptions}
			/>
		</PageShell>
	);
}
