import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokens } from "@/lib/api-token/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell, PageHeader } from "@/components/page-shell";

export const revalidate = 60;

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requireSession("/api-tokens");
	if (!sessionHasPermission(session, "api-token:manage")) {
		return (
			<PageShell>
				<section data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] p-6">
					<h1 className="text-xl font-semibold text-[var(--danger)]">{t("common.insufficientPermissions", locale)}</h1>
					<p className="mt-2 text-sm text-[var(--danger)]/70">{t("apiTokensPage.permissionDeniedHint", locale)}</p>
				</section>
			</PageShell>
		);
	}
	const tokens = await listApiTokens(session.userId, 200);
	return (
		<PageShell>
			<PageHeader eyebrow={t("apiTokensPage.eyebrow", locale)} title={t("apiTokensPage.title", locale)} description={t("apiTokensPage.desc", locale)}>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] px-4 py-3 text-xs text-[var(--text-muted)]">
					{t("apiTokensPage.hint", locale)}
				</div>
			</PageHeader>
			<ApiTokenManagerClient initialTokens={tokens} allowedScopes={ALLOWED_API_TOKEN_SCOPES} />
		</PageShell>
	);
}
