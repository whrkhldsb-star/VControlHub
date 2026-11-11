import { describe, expect, it } from "vitest";

import {
  groupHistory,
  type TrafficHistoryPoint,
} from "../traffic-page-client";

function point(overrides: Partial<TrafficHistoryPoint>): TrafficHistoryPoint {
  return {
    source: "local",
    serverId: null,
    iface: "eth0",
    rx: 1,
    tx: 2,
    t: "2026-08-27T02:00:00.000Z",
    ...overrides,
  };
}

describe("groupHistory", () => {
  it("keeps each interface on its own curve in the 24h view", () => {
    const grouped = groupHistory(
      [
        point({ iface: "eth0", rx: 10 }),
        point({ iface: "docker0", rx: 20 }),
        point({ iface: "eth0", rx: 30 }),
      ],
      "24h",
    );
    expect([...grouped.keys()]).toEqual(["eth0", "docker0"]);
    expect(grouped.get("eth0")?.map((item) => item.rx)).toEqual([10, 30]);
    expect(grouped.get("docker0")?.map((item) => item.rx)).toEqual([20]);
  });

  it("splits the 7d view by interface and calendar day", () => {
    // Exactly 24h apart, so the two samples fall on different local days in
    // every timezone the viewer might be in.
    const grouped = groupHistory(
      [
        point({ t: "2026-08-27T02:00:00.000Z", rx: 1 }),
        point({ t: "2026-08-28T02:00:00.000Z", rx: 2 }),
        point({ iface: "docker0", t: "2026-08-27T02:00:00.000Z", rx: 3 }),
      ],
      "7d",
    );
    const keys = [...grouped.keys()];
    expect(keys).toHaveLength(3);
    expect(keys.every((key) => /^(eth0|docker0) · \d{4}-\d{2}-\d{2}$/.test(key))).toBe(true);
    // No key may mix two interfaces.
    expect(keys.filter((key) => key.startsWith("eth0 · "))).toHaveLength(2);
    expect(keys.filter((key) => key.startsWith("docker0 · "))).toHaveLength(1);
  });

  it("cuts the 7d view at midnight of the zone its axis is labelled in", () => {
    // The days were the browser's own, the times under each curve the application's: seen from another zone a
    // curve named for one day ran across midnight on its own axis.
    const grouped = groupHistory(
      [
        // 23:30 and 00:30 in Asia/Shanghai, the default application zone: two days there, one day in UTC.
        point({ t: "2026-08-27T15:30:00.000Z", rx: 1 }),
        point({ t: "2026-08-27T16:30:00.000Z", rx: 2 }),
      ],
      "7d",
    );
    expect([...grouped.keys()]).toEqual(["eth0 · 2026-08-27", "eth0 · 2026-08-28"]);
  });
});
