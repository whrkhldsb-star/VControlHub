import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listSnippets } from "@/lib/snippet/service";
import { PageShell, PageHeader, PermissionDenied } from "@/components/page-shell";
import { SnippetList } from "./snippet-list-client";
import { t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await requireSession("/snippets");
	if (!sessionHasPermission(session, "snippet:manage")) return <PermissionDenied />;
	const snippets = await listSnippets({ userId: session.userId });

	const serialized = snippets.map((s) => ({
		...s,
	}));

	return (
		<PageShell>
			<PageHeader
				eyebrow="Snippets"
				title={t("snippetsPage.pageTitle")}
				description={t("snippetsPage.pageDescription")}
			/>
			<div className="mt-6">
				<SnippetList snippets={serialized} />
			</div>
		</PageShell>
	);
}
