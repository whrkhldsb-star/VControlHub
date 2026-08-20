import { describe, expect, it } from "vitest";

import {
  computeNextPlaybookCronRun,
  isValidPlaybookCronExpression,
  metricMatchesThreshold,
  metricValueForTrigger,
  normalizePlaybookCronExpression,
  parseMetricMatchState,
} from "../trigger-utils";

describe("Playbook trigger utilities", () => {
  it("accepts only valid five-field Cron expressions", () => {
    expect(normalizePlaybookCronExpression("  0   3  * * * ")).toBe("0 3 * * *");
    expect(isValidPlaybookCronExpression("0 3 * * *")).toBe(true);
    expect(isValidPlaybookCronExpression("0 3 * * * *")).toBe(false);
    expect(isValidPlaybookCronExpression("not a cron expression")).toBe(false);
  });

  it("computes Cron schedules in the application time zone", () => {
    // 2026-01-02 02:00 Asia/Shanghai; the next 03:00 occurrence is 19:00Z.
    const next = computeNextPlaybookCronRun("0 3 * * *", new Date("2026-01-01T18:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-01-01T19:00:00.000Z");
  });

  it("maps trigger metrics and evaluates all supported comparison operators", () => {
    const reading = { cpu: 81, mem: 64, diskMax: 90 };
    expect(metricValueForTrigger("cpu_usage", reading)).toBe(81);
    expect(metricValueForTrigger("mem_usage", reading)).toBe(64);
    expect(metricValueForTrigger("disk_usage", reading)).toBe(90);
    expect(metricMatchesThreshold(81, "gt", 80)).toBe(true);
    expect(metricMatchesThreshold(81, "gte", 81)).toBe(true);
    expect(metricMatchesThreshold(81, "lt", 80)).toBe(false);
    expect(metricMatchesThreshold(81, "lte", 81)).toBe(true);
    expect(metricMatchesThreshold(81, "eq", 81)).toBe(true);
  });

  it("drops malformed metric edge state instead of trusting it", () => {
    expect(parseMetricMatchState({
      valid: { breached: true, sampleAt: "2026-08-20T00:00:00.000Z", value: 91 },
      badDate: { breached: true, sampleAt: "later", value: 91 },
      badValue: { breached: false, sampleAt: "2026-08-20T00:00:00.000Z", value: "91" },
    })).toEqual({
      valid: { breached: true, sampleAt: "2026-08-20T00:00:00.000Z", value: 91 },
    });
  });
});
