import { describe, expect, it } from "vitest";

import { getServerTargetAvailability } from "../availability";

describe("getServerTargetAvailability", () => {
  const now = new Date("2026-08-09T05:00:00.000Z").getTime();

  it("blocks incomplete onboarding and a recent explicit offline probe", () => {
    expect(getServerTargetAvailability({ onboardingStatus: "DRAFT" }, now)).toEqual({ available: false, reason: "setup-incomplete" });
    expect(getServerTargetAvailability({
      onboardingStatus: "READY",
      latestMetric: { isOnline: false, createdAt: "2026-08-09T04:58:00.000Z" },
    }, now)).toEqual({ available: false, reason: "recently-offline" });
  });

  it("does not permanently block a node on a stale probe", () => {
    expect(getServerTargetAvailability({
      onboardingStatus: "READY",
      latestMetric: { isOnline: false, createdAt: "2026-08-09T04:30:00.000Z" },
    }, now)).toEqual({ available: true, reason: null });
  });
});
