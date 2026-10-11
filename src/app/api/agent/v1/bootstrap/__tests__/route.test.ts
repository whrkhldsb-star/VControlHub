import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withRateLimit: vi.fn(), authenticateServerAgent: vi.fn(), buildWindowsAgentInstaller: vi.fn(), baseUrl: "https://hub.example" }));
vi.mock("@/lib/http/rate-limit-presets", () => ({ AGENT_POLL_LIMIT: { maxRequests: 10, windowMs: 1000 }, withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/server/agent-service", () => ({ authenticateServerAgent: mocks.authenticateServerAgent, buildWindowsAgentInstaller: mocks.buildWindowsAgentInstaller }));
vi.mock("@/lib/config/env", () => ({ config: { app: { get baseUrl() { return mocks.baseUrl; } } } }));

const route = await import("../route");
const get = (authorization?: string) => route.GET(new Request("http://local/api/agent/v1/bootstrap", { headers: authorization ? { authorization } : {} }));

describe("GET /api/agent/v1/bootstrap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.baseUrl = "https://hub.example";
		mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
		mocks.authenticateServerAgent.mockResolvedValue({ id: "srv_1", operatingSystem: "WINDOWS" });
		mocks.buildWindowsAgentInstaller.mockReturnValue("# installer script");
	});

	it("serves the Windows installer only to an authenticated Windows agent", async () => {
		const res = await get("Bearer agent-token");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
		expect(await res.text()).toBe("# installer script");
		expect(mocks.authenticateServerAgent).toHaveBeenCalledWith("agent-token");
		expect(mocks.buildWindowsAgentInstaller).toHaveBeenCalledWith("https://hub.example", "agent-token");
	});

	it("rejects unknown tokens, non-Windows agents, rate limits and a missing hub URL", async () => {
		mocks.authenticateServerAgent.mockResolvedValueOnce(null);
		expect((await get("Bearer bad")).status).toBe(401);
		mocks.authenticateServerAgent.mockResolvedValueOnce({ id: "srv_2", operatingSystem: "LINUX" });
		expect((await get("Bearer linux")).status).toBe(404);
		mocks.withRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterMs: 4000 });
		const limited = await get("Bearer agent-token");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("4");
		mocks.baseUrl = "";
		expect((await get("Bearer agent-token")).status).toBe(503);
		expect(mocks.buildWindowsAgentInstaller).not.toHaveBeenCalled();
	});
});
