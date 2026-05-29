import { describe, expect, it, vi } from "vitest";

const { requireApiSessionMock } = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(async () => ({
    userId: "u1",
    username: "alice",
  })),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string) => {
      if (path === "/proc/stat") return "cpu  100 0 100 800 0 0 0 0 0 0\n";
      if (path === "/proc/net/dev") {
        return `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
  eth0: 4096 1 0 0 0 0 0 0 8192 1 0 0 0 0 0 0
`;
      }
      return "";
    }),
    readdirSync: vi.fn(() => []),
    statfsSync: vi.fn(() => ({ blocks: 1000, bsize: 1024, bfree: 250 })),
  };
});

import { GET } from "../route";

describe("monitoring stats route", () => {
  it("uses auth-only API guard and returns runtime stats", async () => {
    const response = await GET(
      new Request("http://local/api/monitoring/stats"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(body.cpu.usage).toMatch(/^\d+(?:\.\d)?%$|^N\/A%$/);
    expect(body.disk).toContain("used");
    expect(Array.isArray(body.network)).toBe(true);
    expect(body.timestamp).toEqual(expect.any(String));
  });
});
