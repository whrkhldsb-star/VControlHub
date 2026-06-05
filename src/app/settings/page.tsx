import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings } from "@/lib/settings/service";
import { prisma } from "@/lib/db";

import { SettingsClient } from "./settings-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
	const session = await requireSession();
	const canManage = sessionHasPermission(session, "user:manage");

	const settings = canManage ? await getAllSettings() : {};
	const userSecurity = await prisma.user.findUnique({
		where: { id: session.userId },
		select: { twoFactorEnabled: true },
	});
	const twoFactorEnabled = userSecurity?.twoFactorEnabled ?? false;

	return (
		<PageShell maxW="max-w-7xl">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">系统设置</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						配置平台名称、安全策略、邮件通知等全局参数
					</p>
				</header>
				<SettingsClient settings={settings} canManage={canManage} twoFactorEnabled={twoFactorEnabled} />
		</PageShell>
	);
}
