import { describe, expect, it } from "vitest";

import { browserT } from "@/lib/i18n/browser-translations";

import { commandStatusLine, directGatewayModeLabel, serverConnectionLabel, serverConnectionSummary, serverEnabledLabel } from "../server-labels";

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

	it("words the state of a command on this server", () => {
		// The details panel printed the two enum values: "PENDING_APPROVAL · PENDING_APPROVAL", "RUNNING · COMPLETED".
		const zh = (key: string, vars?: Record<string, string | number>) => browserT(key, "zh", vars);
		const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);
		expect(commandStatusLine("PENDING_APPROVAL", "PENDING_APPROVAL", zh)).toBe("等待审批");
		expect(commandStatusLine("RUNNING", "COMPLETED", zh)).toBe("本节点：已完成 · 整体：执行中");
		expect(commandStatusLine("CANCELLING", "CANCELLING", zh)).toBe("正在取消");
		expect(commandStatusLine("RUNNING", "FAILED", en)).toBe("This node: Failed · Overall: Running");
	});
});
