/** @vitest-environment node */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", () => ({ config: { app: { baseUrl: "https://hub.example.com" } } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));

import { buildAgentPowerShell, buildAgentPython } from "../agent-service";
import { AGENT_VERSION, WINDOWS_AGENT_VERSION, currentAgentVersion, isAgentOutdated } from "../agent-version";

const HUB = "https://hub.example.com";
const TOKEN = "vca_fingerprint_token";
const fingerprint = (script: string) => createHash("sha256").update(script.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

/**
 * Installed Agents keep the build they were installed with; Linux Agents fetch a new one only when the
 * hub's version differs from theirs. The stop-race fix changed the Linux script without moving the version,
 * so no running Agent received it. A script that changes must move its platform's version: when this test
 * fails, raise that version (agent-version.ts) and record the new fingerprint here.
 */
const RECORDED = {
	linux: { version: "1.5.2", fingerprint: "fb1b823253f0620c" },
	windows: { version: "1.5.1", fingerprint: "b2cd79a295dde29e" },
};

describe("Agent versions", () => {
	it("each script carries its own platform's version", () => {
		expect(buildAgentPython(HUB, TOKEN)).toContain(`VERSION=${JSON.stringify(AGENT_VERSION)}`);
		expect(buildAgentPowerShell(HUB, TOKEN)).toContain(`$VERSION = ${JSON.stringify(WINDOWS_AGENT_VERSION)}`);
	});

	it("a script that changed moved its version", () => {
		expect({ version: AGENT_VERSION, fingerprint: fingerprint(buildAgentPython(HUB, TOKEN)) }, "Linux Agent").toEqual(RECORDED.linux);
		expect({ version: WINDOWS_AGENT_VERSION, fingerprint: fingerprint(buildAgentPowerShell(HUB, TOKEN)) }, "Windows Agent").toEqual(RECORDED.windows);
	});

	it("a Linux release does not ask Windows nodes to install again", () => {
		expect(currentAgentVersion("linux")).toBe(AGENT_VERSION);
		expect(currentAgentVersion("windows")).toBe(WINDOWS_AGENT_VERSION);
		expect(isAgentOutdated(WINDOWS_AGENT_VERSION, "windows")).toBe(false);
		expect(isAgentOutdated("1.4.0", "windows")).toBe(true);
		expect(isAgentOutdated(AGENT_VERSION)).toBe(false);
		expect(isAgentOutdated("1.5.0")).toBe(true);
		expect(isAgentOutdated(null)).toBe(false);
	});
});
