import { describe, expect, it } from "vitest";

import { formatStorageHealthStatus } from "../traffic-page-client";

describe("TrafficPage storage status labels", () => {
  it("renders sampled health statuses as operator-friendly Chinese labels", () => {
    expect(formatStorageHealthStatus("HEALTHY")).toBe("在线");
    expect(formatStorageHealthStatus("WARNING")).toBe("需关注");
    expect(formatStorageHealthStatus("CRITICAL")).toBe("异常");
    expect(formatStorageHealthStatus("UNKNOWN")).toBe("未采样");
    expect(formatStorageHealthStatus("")).toBe("未采样");
  });
});
