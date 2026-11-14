/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The language of a WebDAV answer's text. The route is not behind withApiRoute, so the backend copy had no request
 * to read a language from: refusals written with the service-layer t() came out Chinese and those written with
 * apiCopy() English, for the same client.
 */
const mocks = vi.hoisted(() => ({ withRateLimit: vi.fn(), authenticateWebDavRequest: vi.fn() }));

vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await import("@/lib/http/rate-limit-presets");
  return { WEBDAV_LIMIT: actual.WEBDAV_LIMIT, withRateLimit: mocks.withRateLimit };
});
vi.mock("@/lib/webdav/auth", async () => {
  const actual = await import("@/lib/webdav/auth");
  return { authenticateWebDavRequest: mocks.authenticateWebDavRequest, UnknownWebDavTokenError: actual.UnknownWebDavTokenError, webDavUnauthorizedResponse: actual.webDavUnauthorizedResponse };
});
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const { GET } = await import("../route");

const refused = (headers: Record<string, string> = {}) =>
  GET(new Request("https://hub.example/api/webdav/n1/docs/../secret.txt", { headers }), {
    params: Promise.resolve({ storageNodeId: "n1", path: ["docs", "..", "secret.txt"] }),
  });

describe("webdav answers", () => {
  beforeEach(() => {
    mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    mocks.authenticateWebDavRequest.mockResolvedValue({ session: { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_a" } });
  });

  it("are in English for a client that names no language", async () => {
    const response = await refused();
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Path must not contain . or ..");
  });

  it("are in the language the client asks for", async () => {
    expect(await (await refused({ "accept-language": "zh-CN,zh;q=0.9" })).text()).toBe("路径不能包含 . 或 ..");
    expect(await (await refused({ "accept-language": "en-US" })).text()).toBe("Path must not contain . or ..");
  });
});
