import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokens } from "@/lib/api-token/service";
import { t } from "@/lib/i18n/translations";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell, PageHeader } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await requireSession("/api-tokens");
	if (!sessionHasPermission(session, "api-token:manage")) {
		return (
			<PageShell>
				<section data-tone="rose" className="rounded-2xl border border-rose-400/20 p-6">
					<h1 className="text-xl font-semibold text-rose-100">{t("common.insufficientPermissions")}</h1>
					<p className="mt-2 text-sm text-rose-100/70">需要 api-token:manage 权限才能管理个人 API Token。</p>
				</section>
			</PageShell>
		);
	}
	const tokens = await listApiTokens(session.userId, 200);
	return (
		<PageShell>
			<PageHeader eyebrow="Access Tokens" title="个人 API Token" description="用于脚本、监控或外部系统读取平台状态。创建后只展示一次明文，数据库仅保存哈希、前缀、尾缀、权限范围和过期时间。">
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs text-[var(--text-muted)]">
					建议为每个用途创建独立 Token，并设置最小权限与过期时间。
				</div>
			</PageHeader>
			<ApiTokenManagerClient initialTokens={tokens} allowedScopes={ALLOWED_API_TOKEN_SCOPES} />
		</PageShell>
	);
}
