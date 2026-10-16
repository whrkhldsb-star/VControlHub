import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTemplates } from "@/lib/command-template/service";
import { listServerProfiles } from "@/lib/server/service";

import { TemplateListClient } from "./template-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { localizeBuiltinTemplate } from "@/lib/command-template/builtin-labels";

export const dynamic = "force-dynamic";

export default async function CommandTemplatesPage() {
	const session = await requirePagePermission("command:read", { redirectTo: "/templates" });
	const canCreate = sessionHasPermission(session, "command:create");
	const canDeploy = sessionHasPermission(session, "deploy:run");
	const canReadServers = sessionHasPermission(session, "server:read");
	const locale = await getServerLocale();

	const [templates, servers] = await Promise.all([
		listTemplates(200, session).then((rows) => rows.map((row) => localizeBuiltinTemplate(row, (key) => t(key, locale)))),
		canDeploy && canReadServers ? listServerProfiles(session) : Promise.resolve([]),
	]);

	const serialized = templates.map((t) => ({
		id: t.id, name: t.name, description: t.description,
		command: t.command, rollbackCommand: t.rollbackCommand, variables: t.variables, tags: t.tags,
		isBuiltin: t.isBuiltin,
		createdAt: t.createdAt.toISOString(),
		creator: t.creator ? { username: t.creator.username, displayName: t.creator.displayName } : null,
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("templatesPage.eyebrow", locale)}
				title={t("templatesPage.title", locale)}
				description={t("templatesPage.desc", locale)}
			/>
			<TemplateListClient templates={serialized} servers={serverOptions} canCreate={canCreate} canDeploy={canDeploy} locale={locale} />
		</PageShell>
	);
}
