import { requirePagePermission } from "@/lib/auth/page-guard";
import { ALLOWED_API_TOKEN_SCOPES, listApiTokenPage } from "@/lib/api-token/service";
import { apiTokenScopeAllowedForSession } from "@/lib/api-token/authorization";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { ApiTokenManagerClient } from "./api-token-manager-client";
import { PageShell } from "@/components/page-shell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("api-token:manage", { redirectTo: "/api-tokens" });
	const pageSize = 25;
	const [page, customer] = await Promise.all([
		listApiTokenPage(session.userId, { pageSize }),
		session.currentTeamId ? prisma.team.findUnique({ where: { id: session.currentTeamId }, select: { name: true } }) : null,
	]);
	const allowedScopes = ALLOWED_API_TOKEN_SCOPES.filter((scope) =>
		apiTokenScopeAllowedForSession(scope, session),
	);
	return (
		<PageShell>
			<ApiTokenManagerClient
				key={session.userId}
				header={{ eyebrow: t("apiTokensPage.eyebrow", locale), title: t("apiTokensPage.title", locale), description: t("apiTokensPage.desc", locale) }}
				initialPage={page} pageSize={pageSize} allowedScopes={allowedScopes} currentCustomerName={customer?.name ?? null} />
		</PageShell>
	);
}
