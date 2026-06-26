import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings, getSettingUpdateMetadata } from "@/lib/settings/service";
import { getRuntimeSettingSummaries } from "@/lib/runtime-settings/service";
import { prisma } from "@/lib/db";

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
];

export default async function SettingsPage() {
	const session = await requireSession();
	const canManage = sessionHasPermission(session, "user:manage");

	const [settings, runtimeSettings, settingUpdateMetadata] = canManage
		? await Promise.all([
			getAllSettings(),
			getRuntimeSettingSummaries(),
			getSettingUpdateMetadata(SETTINGS_AUDIT_KEYS),
		])
		: [{}, [], {}];
	const userSecurity = await prisma.user.findUnique({
		where: { id: session.userId },
		select: { twoFactorEnabled: true },
	});
	const twoFactorEnabled = userSecurity?.twoFactorEnabled ?? false;

	return (
		<PageShell maxW="max-w-7xl">
			<UnifiedSettingsPageClient settings={settings} runtimeSettings={runtimeSettings} settingUpdateMetadata={settingUpdateMetadata} canManage={canManage} twoFactorEnabled={twoFactorEnabled} />
		</PageShell>
	);
}
