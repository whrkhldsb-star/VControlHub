// @vitest-environment node
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32" && !process.env.TEST_PWSH)("launches a single worker role even when the env file enables workers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vch-windows-role-"));
  const script = path.join(root, "deploy", "windows", "run.ps1");
  try {
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(path.join(root, "dist"));
    await copyFile(path.resolve("deploy/windows/run.ps1"), script);
    await writeFile(path.join(root, ".env.local"), "VCONTROLHUB_WORKERS_DISABLED=false\n");
    for (const [role, entry] of [["web", "server"], ["worker", "worker"], ["ssh-ws", "ssh-ws-proxy"]]) {
      await writeFile(path.join(root, "dist", entry + ".js"), "console.log(process.env.VCONTROLHUB_WORKERS_DISABLED)");
      execFileSync(process.env.TEST_PWSH || "powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script, "-Role", role!, "-NodeExe", process.execPath]);
      const output = await readFile(path.join(root, "logs", "windows-" + role + ".log"));
      // Windows PowerShell redirects to UTF-16LE and PowerShell 7 to UTF-8.
      const value = output.toString(output[0] === 0xff ? "utf16le" : "utf8").trim();
      expect(value).toBe(role === "worker" ? "false" : "true");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
