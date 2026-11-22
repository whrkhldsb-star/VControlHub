/** Service identifiers used by deploy/install.sh and deploy/windows/publish-release.ps1. */
export function deploymentServiceChecks(input: {
  platform: NodeJS.Platform; appSlug: string; servicePrefix?: string; cgroup?: string;
  proxy?: "caddy" | "apache2";
}) {
  const roles = [
    { id: "next-service", label: "Next.js service", suffix: "next", task: "VControlHub Web" },
    { id: "worker-service", label: "Background worker service", suffix: "worker", task: "VControlHub Worker" },
    { id: "ssh-ws-service", label: "SSH WebSocket service", suffix: "ssh-ws", task: "VControlHub SSH WS" },
  ];
  if (input.platform === "win32") return roles.map(({ id, label, task }) => ({
    id, label, unit: task, file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskPath '\\' -TaskName '${task}' -ErrorAction Stop).State.ToString()`],
    running: "Running",
  }));
  if (input.platform !== "linux") return [];
  const observed = input.cgroup?.match(/\/([^/\n]+)-(?:next|worker|ssh-ws)\.service(?:\/|$)/m)?.[1];
  const prefix = observed || input.servicePrefix || input.appSlug;
  const units = roles.map(({ id, label, suffix }) => ({ id, label, unit: `${prefix}-${suffix}.service` }));
  if (input.proxy) units.push({ id: `${input.proxy}-service`, label: "Reverse proxy service", unit: `${input.proxy}.service` });
  return units.map((unit) => ({ ...unit, file: "systemctl", args: ["is-active", unit.unit], running: "active" }));
}
