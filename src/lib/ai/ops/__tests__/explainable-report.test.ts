import { describe, expect, it } from "vitest";

import { buildExplainableReport } from "../scan-worker";
import { AI_OPS_SAFE_AUTONOMOUS_ACTIONS } from "../types";

describe("AI Ops safe closure", () => {
  it("does not allow target-dependent playbook or backup actions without payload", () => {
    expect(AI_OPS_SAFE_AUTONOMOUS_ACTIONS).toEqual(["alert.evaluate", "cache.purge:stale"]);
  });

  it("builds an explainable structured report", () => {
    const report = buildExplainableReport(
      "autonomous",
      [{ id: "resource.high-cpu", severity: "warning", title: "High CPU", body: "CPU > 85%", source: "metric.cpu" }],
      [{ id: "a1", action: "alert.evaluate", risk: "low", executed: true, result: "done" }],
    );
    expect(report).toContain("mode=autonomous");
    expect(report).toContain("warning=1");
    expect(report).toContain("executed=1");
    expect(report).toContain("source=metric.cpu");
  });
});
