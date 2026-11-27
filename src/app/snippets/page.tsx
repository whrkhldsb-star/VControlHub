import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listSnippets, snippetViewer } from "@/lib/snippet/service";
import { PageShell } from "@/components/page-shell";
import { SnippetList } from "./snippet-list-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("snippet:manage", { redirectTo: "/snippets" });
	const canReadTemplates = sessionHasPermission(session, "command:read");
	const snippets = await listSnippets({ viewer: snippetViewer(session) });

	const serialized = snippets.map((s) => ({
		...s,
	}));

	return (
		<PageShell>
			<SnippetList
				header={{ eyebrow: t("snippetsPage.eyebrow", locale), title: t("snippetsPage.pageTitle", locale), description: t("snippetsPage.pageDescription", locale) }}
				snippets={serialized}
				canReadTemplates={canReadTemplates}
			/>
		</PageShell>
	);
}
