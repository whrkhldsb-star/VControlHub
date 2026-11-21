// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";

const clients = vi.hoisted(() => new Set<RedisClientType>());
vi.mock("redis", async (importOriginal) => {
  const redis = await importOriginal<typeof import("redis")>();
  return {
    createClient: (options: { url: string }) => {
      const client = redis.createClient(options);
      clients.add(client);
      return client;
    },
  };
});
vi.mock("@/lib/runtime-settings/service", () => ({
  getRuntimeSettingNumbers: () => ({
    "security.loginLockoutClientFailures": 5, "security.loginLockoutAccountFailures": 25, "security.loginLockoutMinutes": 1,
  }),
}));

describe.skipIf(!process.env.TEST_REDIS_URL)("login lockout across Redis clients", () => {
  const account = "login-test-" + randomUUID();
  const ip = "192.0.2.5";
  const keys = ["rl:lockout:" + account, "rl:lockout:" + account + "@" + ip];
  let first: typeof import("../rate-limit");
  let second: typeof first;

  beforeAll(async () => {
    const endpoint = new URL(process.env.TEST_REDIS_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("Use a loopback test Redis");
    vi.stubEnv("REDIS_URL", endpoint.href);
    vi.resetModules();
    first = await import("../rate-limit");
    vi.resetModules();
    second = await import("../rate-limit");
    await Promise.all([first, second].map(instance => instance.isAccountLockedAsync(account, ip)));
    expect(clients.size).toBe(2);
  });

  afterAll(async () => {
    try {
      await [...clients].find(client => client.isOpen)?.del(keys);
    } finally {
      for (const client of clients) if (client.isOpen) client.destroy();
      vi.unstubAllEnvs();
    }
  });

  it("counts each concurrent failure exactly once and keeps the first lock deadline at each threshold", async () => {
    const failures = await Promise.all(Array.from({ length: 32 }, (_, index) =>
      (index % 2 ? first : second).recordLoginFailureAsync(account, ip)));
    failures.sort((a, b) => a.failCount - b.failCount);
    for (const [index, failure] of failures.entries()) {
      const count = index + 1;
      expect(failure).toMatchObject({ failCount: count, accountFailCount: count,
        scope: count >= 25 ? "account" : count >= 5 ? "client" : null });
      expect(failure.lockedUntil).toBe(count >= 25 ? failures[24]!.lockedUntil : count >= 5 ? failures[4]!.lockedUntil : null);
    }
    const [client] = clients;
    for (const [key, limit] of [[keys[0]!, 24], [keys[1]!, 4]] as const) {
      expect(await client!.pExpireTime(key)).toBe(failures[limit]!.lockedUntil);
    }
    await expect(second.isAccountLockedAsync(account, "192.0.2.6")).resolves.toMatchObject({ scope: "account" });
    await second.clearLoginFailureAsync(account, ip);
    expect(await client!.exists(keys)).toBe(0);
  });

  it("expires legacy JSON locks conditionally while another instance starts the next failure window", async () => {
    const [client] = clients;
    const past = Date.now() - 60_000;
    for (const key of keys) {
      await client!.set(key, JSON.stringify({ failCount: 25, lockedUntil: past, lastFailureAt: past }), { PX: 10_000 });
    }
    await Promise.all([
      first.isAccountLockedAsync(account, ip),
      second.recordLoginFailureAsync(account, ip),
      first.isAccountLockedAsync(account, ip),
    ]);
    for (const key of keys) {
      expect(JSON.parse((await client!.get(key))!)).toMatchObject({ failCount: 1, lockedUntil: null });
      const ttl = await client!.pTTL(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    }
    await client!.set(keys[0]!, JSON.stringify({ failCount: 25, lockedUntil: past, lastFailureAt: past }), { PX: 10_000 });
    await first.isAccountLockedAsync(account, ip);
    expect(await client!.exists(keys[0]!)).toBe(0);
    expect(await client!.exists(keys[1]!)).toBe(1);
  });

  it("continues a legacy failure count and preserves a live lock with a shorter remaining TTL", async () => {
    const [client] = clients;
    const now = Date.now();
    const deadline = now + 10_000;
    await client!.set(keys[0]!, JSON.stringify({ failCount: 24, lockedUntil: null, lastFailureAt: now }), { PX: 30_000 });
    await client!.set(keys[1]!, JSON.stringify({ failCount: 5, lockedUntil: deadline, lastFailureAt: now }), { PX: 30_000 });
    await expect(second.recordLoginFailureAsync(account, ip)).resolves.toMatchObject({ failCount: 6, accountFailCount: 25, scope: "account" });
    expect(await client!.pExpireTime(keys[1]!)).toBe(deadline);
    await client!.set(keys[0]!, JSON.stringify({ failCount: 24, lockedUntil: null, lastFailureAt: now - 900_001 }), { PX: 10_000 });
    await expect(first.recordLoginFailureAsync(account, ip)).resolves.toMatchObject({ failCount: 7, accountFailCount: 1, scope: "client", lockedUntil: deadline });
  });
});
