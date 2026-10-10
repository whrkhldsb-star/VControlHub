import type { ServerOverviewDetailsServer } from "./server-overview-details";

type Translate = (key: string, vars?: Record<string, string | number>) => string;
type CredentialView = Pick<
	ServerOverviewDetailsServer,
	"connectionType" | "managementMode" | "hasSshCredential" | "host" | "port" | "username" | "sshKey"
>;

/**
 * How the console logs in to a node, in the viewer's language. "Agent only"
 * is reserved for Agent-managed nodes; a direct node without a stored
 * credential is reported as unconfigured, not as an Agent node.
 */
export function serverConnectionLabel(server: CredentialView, t: Translate): string {
	if (server.hasSshCredential === false) {
		return server.managementMode === "AGENT" ? t("serversPage.management.agentOnly") : t("serverLabels.noCredential");
	}
	return server.connectionType === "SSH_KEY" ? t("serverLabels.sshKey") : t("serverLabels.password");
}

export function serverConnectionSummary(server: CredentialView, t: Translate): string {
	const target = `${server.username}@${server.host}:${server.port}`;
	if (server.hasSshCredential === false) {
		return server.managementMode === "AGENT"
			? t("serverLabels.summary.agentOnly", { host: server.host })
			: t("serverLabels.summary.noCredential", { target });
	}
	return server.connectionType === "SSH_KEY"
		? t("serverLabels.summary.sshKey", { target, key: server.sshKey?.name ?? t("serverLabels.unknownKey") })
		: t("serverLabels.summary.password", { target });
}

/** Whether file transfers go straight to the node or through the website. */
export function directGatewayModeLabel(enabled: boolean | undefined, t: Translate): string {
	return enabled ? t("serverLabels.directFromNode") : t("serverOverviewCard.websiteRelay");
}

export function serverEnabledLabel(enabled: boolean, t: Translate): string {
	return enabled ? t("serverLabels.enabled") : t("serverOverviewCard.disabled");
}
