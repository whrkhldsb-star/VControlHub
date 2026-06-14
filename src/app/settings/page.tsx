import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings, getSettingUpdateMetadata } from "@/lib/settings/service";
import { getRuntimeSettingSummaries } from "@/lib/runtime-settings/service";
import { prisma } from "@/lib/db";

import { SettingsClient } from "./settings-client";
import { PageShell, PageHeader } from "@/components/page-shell";

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
				<PageHeader
					eyebrow="Settings"
					title="系统设置"
					description="配置平台名称、安全策略、邮件通知等全局参数"
				/>
				<SettingsClient settings={settings} runtimeSettings={runtimeSettings} settingUpdateMetadata={settingUpdateMetadata} canManage={canManage} twoFactorEnabled={twoFactorEnabled} />
		</PageShell>
	);
}
