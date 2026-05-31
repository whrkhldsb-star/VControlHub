import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokens } from "@/lib/api-token/service";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await requireSession("/api-tokens");
	if (!sessionHasPermission(session, "api-token:manage")) {
		return (
			<PageShell>
				<section className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] p-6">
					<h1 className="text-xl font-semibold text-rose-100">缺少权限</h1>
					<p className="mt-2 text-sm text-rose-100/70">需要 api-token:manage 权限才能管理个人 API Token。</p>
				</section>
			</PageShell>
		);
	}
	const tokens = await listApiTokens(session.userId, 200);
	return (
		<PageShell>
			<div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/70">Access Tokens</p>
					<h1 className="mt-2 text-3xl font-semibold text-white">个人 API Token</h1>
					<p className="mt-2 max-w-3xl text-sm text-slate-400">
						用于脚本、监控或外部系统读取平台状态。创建后只展示一次明文，数据库仅保存哈希、前缀、尾缀、权限范围和过期时间。
					</p>
				</div>
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs text-slate-500">
					建议为每个用途创建独立 Token，并设置最小权限与过期时间。
				</div>
			</div>
			<ApiTokenManagerClient initialTokens={tokens} allowedScopes={ALLOWED_API_TOKEN_SCOPES} />
		</PageShell>
	);
}
