// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Redis store against a stand-in that implements the five sorted-set
 * commands it pipelines, with Redis's own rank and score semantics. What is
 * pinned here is the order of the pipeline (the window is read after it was
 * trimmed) and that a bucket keeps no more than the caller needs.
 */
type Member = { score: number; value: string };
const sets = new Map<string, Member[]>();
const expiries = new Map<string, number>();
const pipelines: string[][] = [];

function sorted(key: string): Member[] {
  const members = sets.get(key) ?? [];
  members.sort((a, b) => a.score - b.score || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  sets.set(key, members);
  return members;
}

/** Redis rank arguments: negative counts from the end, out-of-range is clamped. */
function rankRange(length: number, start: number, stop: number): [number, number] {
  const from = start < 0 ? Math.max(length + start, 0) : start;
  const to = stop < 0 ? length + stop : Math.min(stop, length - 1);
  return [from, to];
}

vi.mock("redis", () => ({
  createClient: () => {
    let open = false;
    return {
      get isOpen() {
        return open;
      },
      on: () => undefined,
      connect: async () => {
        open = true;
      },
      get: async () => null,
      set: async () => "OK",
      del: async () => 1,
      multi: () => {
        const queue: Array<() => unknown> = [];
        const names: string[] = [];
        pipelines.push(names);
        const pipeline = {
          zAdd(key: string, entry: Member) {
            names.push("zAdd");
            queue.push(() => {
              sorted(key).push(entry);
              return 1;
            });
            return pipeline;
          },
          zRemRangeByScore(key: string, min: number, max: number) {
            names.push("zRemRangeByScore");
            queue.push(() => {
              const before = sorted(key);
              const kept = before.filter((member) => member.score < min || member.score > max);
              sets.set(key, kept);
              return before.length - kept.length;
            });
            return pipeline;
          },
          zRemRangeByRank(key: string, start: number, stop: number) {
            names.push("zRemRangeByRank");
            queue.push(() => {
              const before = sorted(key);
              const [from, to] = rankRange(before.length, start, stop);
              if (to < from) return 0;
              const kept = before.filter((_member, index) => index < from || index > to);
              sets.set(key, kept);
              return before.length - kept.length;
            });
            return pipeline;
          },
          zRange(key: string, start: number, stop: number) {
            names.push("zRange");
            queue.push(() => {
              const members = sorted(key);
              const [from, to] = rankRange(members.length, start, stop);
              return members.slice(from, to + 1).map((member) => member.value);
            });
            return pipeline;
          },
          pExpire(key: string, ms: number) {
            names.push("pExpire");
            queue.push(() => {
              expiries.set(key, ms);
              return 1;
            });
            return pipeline;
          },
          execAsPipeline: async () => queue.map((run) => run()),
        };
        return pipeline;
      },
    };
  },
}));

async function freshStore() {
  vi.resetModules();
  const { getRateLimitStore } = await import("@/lib/rate-limit-store");
  return getRateLimitStore();
}

describe("Redis rate-limit store", () => {
  beforeEach(() => {
    sets.clear();
    expiries.clear();
    pipelines.length = 0;
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the timestamps of the window, oldest first, and lets the key expire with it", async () => {
    const store = await freshStore();
    expect(await store.addAndGetWindow("login:fast:203.0.113.9", 1_000, 60_000)).toEqual([1_000]);
    expect(await store.addAndGetWindow("login:fast:203.0.113.9", 2_000, 60_000)).toEqual([1_000, 2_000]);
    // Outside the window by now.
    expect(await store.addAndGetWindow("login:fast:203.0.113.9", 61_500, 60_000)).toEqual([2_000, 61_500]);
    expect(expiries.get("rl:ts:login:fast:203.0.113.9")).toBe(60_000);
    expect(pipelines[0]).toEqual(["zAdd", "zRemRangeByScore", "zRange", "pExpire"]);
  });

  // Every attempt of the window used to stay in the sorted set and come back
  // over the wire on each check: a client sending 100 requests a second into a
  // 15-minute login window made every later request fetch 90,000 members.
  it("keeps and returns only the newest timestamps when the caller says how many it needs", async () => {
    const store = await freshStore();
    let window: number[] = [];
    for (let index = 0; index < 500; index += 1) {
      window = await store.addAndGetWindow("login:slow:203.0.113.9", 10_000 + index, 900_000, 4);
    }
    expect(window).toEqual([10_496, 10_497, 10_498, 10_499]);
    expect(sets.get("rl:ts:login:slow:203.0.113.9")).toHaveLength(4);
    // Trimmed before it is read.
    expect(pipelines.at(-1)).toEqual(["zAdd", "zRemRangeByScore", "zRemRangeByRank", "zRange", "pExpire"]);
  });

  it("does not trim a bucket that holds no more than asked for", async () => {
    const store = await freshStore();
    await store.addAndGetWindow("k", 1, 1_000, 4);
    await store.addAndGetWindow("k", 2, 1_000, 4);
    expect(await store.addAndGetWindow("k", 3, 1_000, 4)).toEqual([1, 2, 3]);
    expect(await store.addAndGetWindow("k", 4, 1_000, 4)).toEqual([1, 2, 3, 4]);
    expect(await store.addAndGetWindow("k", 5, 1_000, 4)).toEqual([2, 3, 4, 5]);
  });

  it("gives the limiter the same verdicts as the in-memory store", async () => {
    const config = { maxRequests: 3, windowMs: 1_000 };
    const run = async (redis: boolean) => {
      vi.stubEnv("REDIS_URL", redis ? "redis://127.0.0.1:6379" : "");
      vi.resetModules();
      sets.clear();
      const { checkRateLimitAsync } = await import("@/lib/rate-limit");
      const verdicts: unknown[] = [];
      let now = 50_000;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      try {
        for (const gap of [0, 10, 10, 10, 10, 5, 400, 1, 600, 300, 1_200, 0, 0, 0, 0, 0, 50, 950, 3]) {
          now += gap;
          verdicts.push(await checkRateLimitAsync("parity", config));
        }
      } finally {
        clock.mockRestore();
      }
      return verdicts;
    };
    expect(await run(true)).toEqual(await run(false));
  });
});
