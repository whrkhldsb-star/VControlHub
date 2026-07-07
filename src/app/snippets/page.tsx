import { requirePagePermission } from "@/lib/auth/page-guard";
import { listSnippets } from "@/lib/snippet/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { SnippetList } from "./snippet-list-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const revalidate = 60;

export default async function Page() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("snippet:manage");
	const snippets = await listSnippets({ userId: session.userId });

	const serialized = snippets.map((s) => ({
		...s,
	}));

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("snippetsPage.eyebrow", locale)}
				title={t("snippetsPage.pageTitle")}
				description={t("snippetsPage.pageDescription")}
			/>
			<div className="mt-6">
				<SnippetList snippets={serialized} />
			</div>
		</PageShell>
	);
}
