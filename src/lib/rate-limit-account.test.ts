// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { clearLoginFailureAsync, isAccountLockedAsync, recordLoginFailureAsync } from "./rate-limit";

vi.mock("@/lib/runtime-settings/service", () => ({
  getRuntimeSettingNumbers: () => ({ "security.loginLockoutClientFailures": 5, "security.loginLockoutAccountFailures": 25, "security.loginLockoutMinutes": 15 }),
}));

afterEach(() => { vi.unstubAllEnvs(); });

it("isolates case-sensitive login identities while accepting the same padding as login", async () => {
  vi.stubEnv("REDIS_URL", "");
  const ip = "192.0.2.1";
  for (let index = 0; index < 5; index++) await recordLoginFailureAsync(" Alice ", ip);
  expect((await isAccountLockedAsync("Alice", ip)).locked).toBe(true);
  expect((await isAccountLockedAsync("alice", ip)).locked).toBe(false);
  await clearLoginFailureAsync("alice", ip);
  expect((await isAccountLockedAsync("Alice", ip)).locked).toBe(true);
});
