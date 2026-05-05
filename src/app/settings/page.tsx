import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings } from "@/lib/settings/service";

import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
	const session = await requireSession();
	const canManage = sessionHasPermission(session, "user:manage");

	const settings = canManage ? await getAllSettings() : {};

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">系统设置</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						配置平台名称、安全策略、邮件通知等全局参数
					</p>
				</header>
				<SettingsClient settings={settings} canManage={canManage} />
			</div>
		</main>
	);
}
