// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkRateLimitAsync } from "../rate-limit";

beforeEach(() => {
  vi.stubEnv("REDIS_URL", "");
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([1, 2, 5])("allows the next request after its advertised delay at a limit of %i", async (maxRequests) => {
  const config = { maxRequests, windowMs: 1_000 };
  const key = `retry-contract-${maxRequests}`;
  for (let index = 0; index < maxRequests; index++) {
    expect((await checkRateLimitAsync(key, config)).allowed).toBe(true);
    vi.advanceTimersByTime(50);
  }
  let blocked = await checkRateLimitAsync(key, config);
  for (let index = 0; index < 3; index++) {
    vi.advanceTimersByTime(50);
    blocked = await checkRateLimitAsync(key, config);
    expect(blocked.allowed).toBe(false);
  }
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
  expect(blocked.retryAfterMs).toBeLessThanOrEqual(config.windowMs);
  vi.advanceTimersByTime(blocked.retryAfterMs);
  expect((await checkRateLimitAsync(key, config)).allowed).toBe(true);
});
