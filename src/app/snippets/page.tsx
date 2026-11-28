import { requirePagePermission } from "@/lib/auth/page-guard";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listSnippets, snippetViewer } from "@/lib/snippet/service";
import { PageShell } from "@/components/page-shell";
import { SnippetList } from "./snippet-list-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requireSession("/snippets");
	const canManage = sessionHasPermission(session, "snippet:manage");
	const canRun = sessionHasPermission(session, "command:create") && sessionHasPermission(session, "server:read");
	if (!canRun && !canManage) await requirePagePermission("snippet:manage", { redirectTo: "/snippets" });
	const canReadTemplates = sessionHasPermission(session, "command:read");
	const snippets = canManage ? await listSnippets({ viewer: snippetViewer(session) }) : [];

	const serialized = snippets.map((s) => ({
		...s,
	}));

	return (
		<PageShell>
			<SnippetList
				header={{ eyebrow: t("snippetsPage.eyebrow", locale), title: t("snippetsPage.pageTitle", locale), description: t("snippetsPage.pageDescription", locale) }}
				snippets={serialized}
				canReadTemplates={canReadTemplates}
				canManage={canManage} canRun={canRun}
			/>
		</PageShell>
	);
}
