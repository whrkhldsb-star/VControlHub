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
      if (path === "/proc/123/stat") {
        const fields = Array.from({ length: 22 }, () => "0");
        fields[0] = "S";
        fields[11] = "200";
        fields[12] = "100";
        fields[21] = "1024";
        return `123 (java) ${fields.join(" ")}`;
      }
      if (path === "/proc/net/dev") {
        return `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
  eth0: 4096 1 0 0 0 0 0 0 8192 1 0 0 0 0 0 0
`;
      }
      return "";
    }),
    readdirSync: vi.fn(() => ["123"]),
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
    expect(body.disk).toMatch(/^\d+(?:\.\d)? [KMGT]B\/\d+(?:\.\d)? [KMGT]B \(\d+% used\)$/);
    expect(Array.isArray(body.network)).toBe(true);
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("reports top-process CPU as a bounded percent instead of cumulative CPU seconds", async () => {
    const response = await GET(new Request("http://local/api/monitoring/stats"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.topProcesses.length).toBeGreaterThan(0);
    for (const process of body.topProcesses) {
      expect(process.cpu).toMatch(/^\d+(?:\.\d)?$/);
      expect(Number(process.cpu)).toBeGreaterThanOrEqual(0);
      expect(Number(process.cpu)).toBeLessThanOrEqual(100);
    }
  });
});
