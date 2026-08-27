import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings, getSettingUpdateMetadata } from "@/lib/settings/service";
import { getRuntimeSettingSummaries } from "@/lib/runtime-settings/service";
import { getAvailableDefaultPageOptions } from "@/lib/preferences/user-preferences";

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
	const session = await requireSession();
	const canManage = sessionHasPermission(session, "user:manage");
	// Config import, cross-team export and secret-bearing export are reserved for
	// the built-in admin role — `user:manage` can also arrive as a direct grant,
	// and the API refuses those callers (see lib/system/platform-admin.ts).
	const isPlatformAdmin = session.roles.includes("admin");
	// Team workspaces authorize per workspace, not via the admin-only `user:manage`
	// gate that guards the rest of this page.
	const teamCapabilities = {
		viewerId: session.userId,
		canCreate: sessionHasPermission(session, "team:create"),
		canManageMembers: sessionHasPermission(session, "team:member:manage"),
		canManageAll: sessionHasPermission(session, "team:manage"),
	};
	const defaultPageOptions = getAvailableDefaultPageOptions((permission) =>
		sessionHasPermission(session, permission),
	);

	const [settings, runtimeSettings, settingUpdateMetadata] = canManage
		? await Promise.all([
			getAllSettings(),
			getRuntimeSettingSummaries(),
			getSettingUpdateMetadata(SETTINGS_AUDIT_KEYS),
		])
		: [{}, [], {}];
	return (
		<PageShell maxW="max-w-7xl">
			<UnifiedSettingsPageClient
				settings={settings}
				runtimeSettings={runtimeSettings}
				settingUpdateMetadata={settingUpdateMetadata}
				canManage={canManage}
				isPlatformAdmin={isPlatformAdmin}
				teamCapabilities={teamCapabilities}
				defaultPageOptions={defaultPageOptions}
			/>
		</PageShell>
	);
}
