/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ app: { baseUrl: "https://hub.example.com" as string | undefined } }));
vi.mock("@/lib/config/env", () => ({ config }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));

import { AGENT_TOKEN_PLACEHOLDER, agentSelfUpdateFor } from "../agent-service";
import { AGENT_VERSION } from "../agent-version";

const capable = { version: "1.4.9", capabilities: ["metrics", "command", "self-update"], requestHost: "hub.example.com" };

describe("agentSelfUpdateFor", () => {
  it("offers the current build, with a token placeholder, to an Agent that can install it", () => {
    const update = agentSelfUpdateFor(capable);
    expect(update?.version).toBe(AGENT_VERSION);
    const script = Buffer.from(update!.script, "base64").toString("utf8");
    expect(script).toContain(`TOKEN=${JSON.stringify(AGENT_TOKEN_PLACEHOLDER)}`);
    expect(script).toContain(`VERSION=${JSON.stringify(AGENT_VERSION)}`);
    expect(script).toContain('ENDPOINT="https://hub.example.com/api/agent/v1/poll"');
  });

  it("leaves alone an Agent that cannot self-update, is current, or failed this version", () => {
    expect(agentSelfUpdateFor({ ...capable, capabilities: ["metrics", "command"] })).toBeNull();
    expect(agentSelfUpdateFor({ ...capable, version: AGENT_VERSION })).toBeNull();
    expect(agentSelfUpdateFor({ ...capable, updateFailed: AGENT_VERSION })).toBeNull();
  });

  it("does not move an Agent to a hub address it did not use", () => {
    // A changed DOMAIN would otherwise repoint every Agent at once.
    expect(agentSelfUpdateFor({ ...capable, requestHost: "old-hub.example.com" })).toBeNull();
    expect(agentSelfUpdateFor({ ...capable, requestHost: null })).toBeNull();
    expect(agentSelfUpdateFor({ ...capable, requestHost: "HUB.example.com:443" })).not.toBeNull();
  });

  it("offers nothing without an HTTPS hub address", () => {
    config.app.baseUrl = "http://hub.example.com";
    try {
      expect(agentSelfUpdateFor(capable)).toBeNull();
    } finally {
      config.app.baseUrl = "https://hub.example.com";
    }
  });
});
