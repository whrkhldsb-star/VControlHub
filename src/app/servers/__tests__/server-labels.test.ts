import { describe, expect, it } from "vitest";

import { directGatewayModeLabel, serverConnectionLabel, serverConnectionSummary, serverEnabledLabel } from "../server-labels";

const t = (key: string, vars?: Record<string, string | number>) =>
	vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

const base = {
	host: "203.0.113.10",
	port: 22,
	username: "root",
	connectionType: "SSH_KEY" as const,
	managementMode: "DIRECT" as const,
	hasSshCredential: true,
	sshKey: { name: "prod" },
};

describe("server labels", () => {
	it("names the stored credential type", () => {
		expect(serverConnectionLabel(base, t)).toBe("serverLabels.sshKey");
		expect(serverConnectionLabel({ ...base, connectionType: "PASSWORD", sshKey: null }, t)).toBe("serverLabels.password");
	});

	it("calls a credential-less node Agent-only only when an Agent manages it", () => {
		expect(serverConnectionLabel({ ...base, hasSshCredential: false, managementMode: "AGENT" }, t)).toBe("serversPage.management.agentOnly");
		expect(serverConnectionLabel({ ...base, hasSshCredential: false, managementMode: "DIRECT" }, t)).toBe("serverLabels.noCredential");
	});

	it("summarises the login target in the viewer's language", () => {
		expect(serverConnectionSummary(base, t)).toBe("serverLabels.summary.sshKey(target=root@203.0.113.10:22,key=prod)");
		expect(serverConnectionSummary({ ...base, hasSshCredential: false, managementMode: "AGENT" }, t)).toBe("serverLabels.summary.agentOnly(host=203.0.113.10)");
		expect(serverConnectionSummary({ ...base, hasSshCredential: false }, t)).toBe("serverLabels.summary.noCredential(target=root@203.0.113.10:22)");
	});

	it("labels the transfer path and the enabled state", () => {
		expect(directGatewayModeLabel(true, t)).toBe("serverLabels.directFromNode");
		expect(directGatewayModeLabel(undefined, t)).toBe("serverOverviewCard.websiteRelay");
		expect(serverEnabledLabel(false, t)).toBe("serverOverviewCard.disabled");
	});
});
