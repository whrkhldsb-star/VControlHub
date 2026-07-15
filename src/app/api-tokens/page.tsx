import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokens } from "@/lib/api-token/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { Callout } from "@/components/ui-primitives";

export const revalidate = 60;

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requireSession("/api-tokens");
	if (!sessionHasPermission(session, "api-token:manage")) {
		return (
			<PageShell>
				<EmptyState variant="boxed">
					<div>
						<div className="text-sm font-medium text-[var(--text-primary)]">{t("common.insufficientPermissions", locale)}</div>
						<p className="mt-2 text-sm text-[var(--text-muted)]">
							{t("apiTokensPage.permissionDeniedHint", locale)}
						</p>
					</div>
				</EmptyState>
			</PageShell>
		);
	}
	const tokens = await listApiTokens(session.userId, 200);
	return (
		<PageShell>
			<PageHeader
				eyebrow={t("apiTokensPage.eyebrow", locale)}
				title={t("apiTokensPage.title", locale)}
				description={t("apiTokensPage.desc", locale)}
			/>
			<div className="mb-5">
				<Callout tone="neutral" title={t("apiTokensPage.hint", locale)} />
			</div>
			<ApiTokenManagerClient initialTokens={tokens} allowedScopes={ALLOWED_API_TOKEN_SCOPES} />
		</PageShell>
	);
}
