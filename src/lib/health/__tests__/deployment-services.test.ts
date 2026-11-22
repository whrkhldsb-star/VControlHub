import { expect, it } from "vitest";
import { deploymentServiceChecks } from "../deployment-services";

it("checks the three Windows deployment tasks at the root of Task Scheduler", () => {
  const checks = deploymentServiceChecks({ platform: "win32", appSlug: "custom" });
  expect(checks.map((check) => check.unit)).toEqual(["VControlHub Web", "VControlHub Worker", "VControlHub SSH WS"]);
  for (const check of checks) {
    expect(check.file).toBe("powershell.exe");
    expect(check.args.at(-1)).toContain(`Get-ScheduledTask -TaskPath '\\' -TaskName '${check.unit}'`);
    expect(check.running).toBe("Running");
  }
});

it("uses the installed Linux unit prefix and checks only the configured proxy", () => {
  const input = { platform: "linux" as const, appSlug: "app", servicePrefix: "custom" };
  expect(deploymentServiceChecks(input).map((check) => check.unit)).toEqual(["custom-next.service", "custom-worker.service", "custom-ssh-ws.service"]);
  expect(deploymentServiceChecks({ ...input, cgroup: "0::/system.slice/live-next.service", proxy: "apache2" }).map((check) => check.unit))
    .toEqual(["live-next.service", "live-worker.service", "live-ssh-ws.service", "apache2.service"]);
});
