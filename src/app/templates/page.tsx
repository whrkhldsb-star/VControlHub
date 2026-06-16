import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTemplates } from "@/lib/command-template/service";
import { listServerProfiles } from "@/lib/server/service";

import { TemplateListClient } from "./template-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function CommandTemplatesPage() {
	const session = await requireSession("/templates");
	const canCreate = sessionHasPermission(session, "command:create");
	const canDeploy = sessionHasPermission(session, "deploy:run");
	const locale = await getServerLocale();

	const [templates, servers] = await Promise.all([
		listTemplates(),
		listServerProfiles(),
	]);

	const serialized = templates.map((t) => ({
		id: t.id, name: t.name, description: t.description,
		command: t.command, variables: t.variables, tags: t.tags,
		isBuiltin: t.isBuiltin,
		createdAt: t.createdAt.toISOString(),
		creator: t.creator ? { username: t.creator.username, displayName: t.creator.displayName } : null,
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));

	return (
		<PageShell maxW="max-w-7xl">
				<PageHeader
				eyebrow="Operations"
				title={t("templatesPage.title", locale)}
				description={t("templatesPage.desc", locale)}
				/>
				<TemplateListClient templates={serialized} servers={serverOptions} canCreate={canCreate} canDeploy={canDeploy} locale={locale} />
		</PageShell>
	);
}
