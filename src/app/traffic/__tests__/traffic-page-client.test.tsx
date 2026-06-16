import { describe, expect, it } from "vitest";

import { t as i18nT } from "@/lib/i18n/translations";
import { formatStorageHealthStatus } from "../traffic-page-client";

describe("TrafficPage storage status labels", () => {
  it("renders sampled health statuses as operator-friendly Chinese labels", () => {
    expect(formatStorageHealthStatus(i18nT, "HEALTHY")).toBe("在线");
    expect(formatStorageHealthStatus(i18nT, "WARNING")).toBe("需关注");
    expect(formatStorageHealthStatus(i18nT, "CRITICAL")).toBe("异常");
    expect(formatStorageHealthStatus(i18nT, "UNKNOWN")).toBe("未采样");
    expect(formatStorageHealthStatus(i18nT, "")).toBe("未采样");
  });
});
