import { requirePagePermission } from "@/lib/auth/page-guard";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokens } from "@/lib/api-token/service";
import { apiTokenScopeAllowedForSession } from "@/lib/api-token/authorization";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell } from "@/components/page-shell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("api-token:manage", { redirectTo: "/api-tokens" });
	const tokens = await listApiTokens(session.userId, 200);
	const customer = session.currentTeamId
		? await prisma.team.findUnique({ where: { id: session.currentTeamId }, select: { name: true } })
		: null;
	const allowedScopes = ALLOWED_API_TOKEN_SCOPES.filter((scope) =>
		apiTokenScopeAllowedForSession(scope, session),
	);
	return (
		<PageShell>
			<ApiTokenManagerClient
				header={{ eyebrow: t("apiTokensPage.eyebrow", locale), title: t("apiTokensPage.title", locale), description: t("apiTokensPage.desc", locale) }}
				initialTokens={tokens} allowedScopes={allowedScopes} currentCustomerName={customer?.name ?? null} />
		</PageShell>
	);
}
