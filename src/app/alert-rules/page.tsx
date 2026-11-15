import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ensureDefaultAlertRules, listAlertRules } from "@/lib/alert/service";
import { toAlertRuleDto } from "@/lib/alert/rule-dto";
import { listServerProfiles } from "@/lib/server/service";
import { listPlaybooks } from "@/lib/playbook/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { withServerActionLocale } from "@/lib/i18n/server-locale";

import { AlertRuleListClient } from "./alert-rule-list-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
	const session = await requirePagePermission("notification:manage", { redirectTo: "/alert-rules" });
	const canManage = sessionHasPermission(session, "notification:manage");
	const canReadServers = sessionHasPermission(session, "server:read");
	const canReadPlaybooks = sessionHasPermission(session, "playbook:read");
	const locale = await getServerLocale();

	if (canManage) {
		// The starter rules are named in the language of whoever opens the page first.
		await withServerActionLocale(() => ensureDefaultAlertRules(session));
	}

	const [rules, servers, playbooks] = await Promise.all([
		// requirePagePermission("notification:manage") above makes canManage always true (A8-04).
		listAlertRules(session),
		canReadServers ? listServerProfiles(session) : Promise.resolve([]),
		canReadPlaybooks ? listPlaybooks(session) : Promise.resolve([]),
	]);

	// The same shape the API answers with, so that a list refreshed from the API is the list rendered here.
	const serialized = rules.map(toAlertRuleDto);

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name }));
	const playbookOptions = playbooks.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled }));

	return (
		<PageShell>
			<AlertRuleListClient
				header={{ eyebrow: t("alertRulesPage.eyebrow", locale), title: t("alertRulesPage.title", locale), description: t("alertRulesPage.desc", locale) }}
				rules={serialized} servers={serverOptions} playbooks={playbookOptions} canManage={canManage} />
		</PageShell>
	);
}
