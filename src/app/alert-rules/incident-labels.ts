import { alertOperatorSign } from "@/lib/alert/operator";

import type { AlertIncident } from "./alert-rule-types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Incidents store an English title and message for outbound channels; the
 * page rebuilds both from the incident's structured fields in the viewer's
 * language and keeps the stored text for metrics it cannot name. Not a client
 * module: the dashboard names the newest open incident the same way on the server.
 */
export function incidentTitle(incident: Pick<AlertIncident, "title" | "serverName" | "metric">, t: Translate): string {
	const metricKey = `alertRulesPage.createForm.metric.${incident.metric}`;
	const metric = t(metricKey);
	return metric === metricKey ? incident.title : t("alertRulesPage.incidents.itemTitle", { server: incident.serverName, metric });
}

export function incidentDetail(
	incident: Pick<AlertIncident, "message" | "metric" | "ruleName" | "operator" | "threshold" | "value">,
	t: Translate,
): string {
	if (incident.metric === "server_offline") return t("alertRulesPage.incidents.detailOffline", { rule: incident.ruleName ?? "" });
	const metricKey = `alertRulesPage.createForm.metric.${incident.metric}`;
	if (t(metricKey) === metricKey) return incident.message;
	return t("alertRulesPage.incidents.detail", {
		rule: incident.ruleName ?? "",
		operator: alertOperatorSign(incident.operator),
		threshold: incident.threshold,
		value: Number.isInteger(incident.value) ? incident.value : incident.value.toFixed(1),
	});
}
