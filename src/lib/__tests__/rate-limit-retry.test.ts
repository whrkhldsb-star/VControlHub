// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkRateLimitAsync } from "../rate-limit";
import { getRateLimitStore } from "../rate-limit-store";

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

// Rejected attempts count against the window, so a client that keeps sending stays blocked. They used to be
// kept as well: every check of such a client filtered (and, in Redis, fetched) all it had sent in the window.
it("keeps a flooding client blocked while storing only what the verdict needs", async () => {
  const config = { maxRequests: 3, windowMs: 60_000 };
  const key = "flood-contract";
  const store = getRateLimitStore();
  for (let index = 0; index < 3; index++) expect((await checkRateLimitAsync(key, config)).allowed).toBe(true);

  let blocked = await checkRateLimitAsync(key, config);
  for (let index = 0; index < 5_000; index++) {
    vi.advanceTimersByTime(1);
    blocked = await checkRateLimitAsync(key, config);
    expect(blocked.allowed).toBe(false);
  }
  // maxRequests + 1 timestamps, however many requests arrived.
  vi.advanceTimersByTime(1);
  expect(await store.addAndGetWindow(key, Date.now(), config.windowMs, config.maxRequests + 1)).toHaveLength(4);

  // The advertised delay is still the moment the next request fits.
  blocked = await checkRateLimitAsync(key, config);
  expect(blocked.allowed).toBe(false);
  vi.advanceTimersByTime(blocked.retryAfterMs - 1);
  expect((await checkRateLimitAsync(`${key}:probe`, config)).allowed).toBe(true);
  vi.advanceTimersByTime(1);
  expect((await checkRateLimitAsync(key, config)).allowed).toBe(true);
});

it("answers exactly as an uncapped window would, request for request", async () => {
  const config = { maxRequests: 4, windowMs: 1_000 };
  const uncapped: number[] = [];
  const reference = (now: number) => {
    const entries = uncapped.filter((t) => t > now - config.windowMs);
    entries.push(now);
    uncapped.splice(0, uncapped.length, ...entries);
    if (entries.length > config.maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(entries[entries.length - config.maxRequests]! + config.windowMs - now, 0), remaining: 0 };
    }
    return { allowed: true, retryAfterMs: 0, remaining: config.maxRequests - entries.length };
  };
  // Bursts, pauses shorter and longer than the window, and a long hammering run.
  const gaps = [0, 10, 10, 10, 10, 5, 5, 400, 1, 1, 1, 700, 300, 1_200, 0, 0, 0, 0, 0, 0, 50, 950, 3, ...Array.from({ length: 300 }, (_, i) => (i % 7) * 3)];
  for (const gap of gaps) {
    vi.advanceTimersByTime(gap);
    expect(await checkRateLimitAsync("parity-contract", config)).toEqual(reference(Date.now()));
  }
});
