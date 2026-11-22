// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

type TestClient = {
  isOpen: boolean;
  del(keys: string[]): Promise<number>;
  destroy(): void;
};
const clients = vi.hoisted(() => new Set<TestClient>());
vi.mock("redis", async (importOriginal) => {
  const redis = await importOriginal<{ createClient(options: { url: string }): TestClient }>();
  return {
    createClient: (options: { url: string }) => {
      const client = redis.createClient(options);
      clients.add(client);
      return client;
    },
  };
});

describe.skipIf(!process.env.TEST_REDIS_URL)("security-setting failure budget across Redis clients", () => {
  const account = "settings-test-" + randomUUID();
  const key = "security-settings:" + createHash("sha256").update(account).digest("hex");

  afterAll(async () => {
    try {
      const client = [...clients].find(opened => opened.isOpen);
      await client?.del(["rl:challenge:" + key, "rl:lockout:" + key]);
    } finally {
      for (const client of clients) if (client.isOpen) client.destroy();
      vi.unstubAllEnvs();
    }
  });

  it("shares concurrent failures and rejects the next challenge before either verifier runs", async () => {
    const endpoint = new URL(process.env.TEST_REDIS_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("Use a loopback test Redis");
    vi.stubEnv("REDIS_URL", endpoint.href);
    vi.resetModules();
    const first = await import("../security-challenge-budget");
    vi.resetModules();
    const second = await import("../security-challenge-budget");
    const finish = Promise.withResolvers<boolean>();
    const verify = vi.fn(() => finish.promise);
    const running = Promise.allSettled([first, second, first, second, first].map(instance =>
      instance.checkSecurityChallenge(account, verify, Boolean)));
    try {
      await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(5));
      await expect(second.checkSecurityChallenge(account, verify, Boolean)).rejects.toMatchObject({ status: 429 });
    } finally {
      finish.resolve(false);
      await running;
    }
    expect(clients.size).toBe(2);
    expect(verify).toHaveBeenCalledTimes(5);
    verify.mockClear().mockResolvedValue(true);
    for (const instance of [first, second]) {
      await expect(instance.checkSecurityChallenge(account, verify, Boolean)).rejects.toMatchObject({ status: 429 });
    }
    expect(verify).not.toHaveBeenCalled();
  });
});
