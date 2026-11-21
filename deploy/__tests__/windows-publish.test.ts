// @vitest-environment node
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const pwsh = process.env.TEST_PWSH || "powershell.exe";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const app = await mkdtemp(path.join(tmpdir(), "vch-win-install-"));
  roots.push(app);
  for (const dir of ["deploy", "deploy/windows", "deploy/lib", "node_modules", ".next", "dist", "bin"]) await mkdir(path.join(app, dir));
  for (const file of ["windows/install.ps1", "windows/publish-release.ps1", "windows/read-install-env.mjs", "lib/release-directories.txt", "check-aria2-secret.mjs", "check-node-version.mjs", "env.production.example"]) {
    await copyFile(path.resolve("deploy", file), path.join(app, "deploy", file));
  }
  await writeFile(path.join(app, "deploy/check-upgrade-migrations.mjs"), "process.exit(0)");
  for (const artifact of ["node_modules/version", ".next/BUILD_ID", "dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) await writeFile(path.join(app, artifact), "old");
  return app;
}

const roles = ["VControlHub Web", "VControlHub Worker", "VControlHub SSH WS"];
// Exercise the real build, switching, and rollback control flow using a task
// scheduler in memory. Filesystem moves and UriBuilder run in PowerShell.
const harness = `
$ErrorActionPreference = 'Stop'
$app = $env:FIXTURE
$env:PORT = '4891'
$env:NEXT_HOST = '::1'
$global:tasks = @{
  'VControlHub Web' = @{ TaskPath='\\'; TaskName='VControlHub Web'; State='Running'; Xml='old-web' }
  'VControlHub Worker' = @{ TaskPath='\\'; TaskName='VControlHub Worker'; State='Ready'; Xml='old-worker' }
}
if ($env:BREAK_AT -eq 'fresh') { $global:tasks = @{} }
function Get-ScheduledTask($TaskPath, $TaskName) {
  if ($TaskName) { $tasks[$TaskName] }
  elseif ($TaskPath -and !$tasks.Count) { throw 'No tasks found with the specified TaskPath' }
  else { $tasks.Values }
}
function Export-ScheduledTask($TaskPath, $TaskName) { $tasks[$TaskName].Xml }
function Stop-ScheduledTask($InputObject) { $InputObject.State = 'Ready' }
function New-ScheduledTaskSettingsSet { 'settings' }
function New-ScheduledTaskPrincipal { 'principal' }
function New-ScheduledTaskAction { 'action' }
function New-ScheduledTaskTrigger { 'trigger' }
function Register-ScheduledTask($TaskName, $Xml, $TaskPath) {
  if ($env:BREAK_AT -eq 'register' -and $TaskName -eq 'VControlHub SSH WS' -and !$Xml) { throw 'register failure' }
  if (!$Xml) { $Xml = 'new' }
  $tasks[$TaskName] = @{ TaskPath='\\'; TaskName=$TaskName; State='Ready'; Xml=$Xml }
}
function Start-ScheduledTask($TaskName) {
  if ($env:BREAK_AT -eq 'start' -and $TaskName -eq 'VControlHub Worker' -and $tasks[$TaskName].Xml -eq 'new') { throw 'start failure' }
  $tasks[$TaskName].State = 'Running'
}
function Unregister-ScheduledTask($TaskName, $TaskPath, $Confirm) { $tasks.Remove($TaskName) }
function Start-Sleep { }
function Invoke-WebRequest($Uri, $TimeoutSec, [switch]$UseBasicParsing) {
  if ($env:BREAK_AT -eq 'health') { throw 'unavailable' }
  if ($Uri -ne 'http://[::1]:4891/login') { throw "Incorrect IPv6 health endpoint $Uri" }
  @{ StatusCode=200 }
}
function npm.cmd {
  if ($PWD.Path -eq $app) { throw 'build touched live working directory' }
  if ($args[0] -eq 'ci' -and $env:BREAK_AT -ne 'fresh' -and $tasks['VControlHub Web'].State -ne 'Running') { throw 'web stopped before build' }
  $global:LASTEXITCODE = 0
  if ($env:BREAK_AT -eq 'build' -and $args[1] -eq 'build') { $global:LASTEXITCODE=1 }
  if ($env:BREAK_AT -eq 'migration' -and $args[1] -eq 'prisma:deploy') { $global:LASTEXITCODE=1 }
  if ($args[1] -eq 'build:runtime') {
    foreach ($dir in @('node_modules','.next','dist')) { New-Item -ItemType Directory $dir | Out-Null }
    foreach ($f in @('node_modules/version','.next/BUILD_ID','dist/server.js','dist/worker.js','dist/ssh-ws-proxy.js')) { [IO.File]::WriteAllText((Join-Path $PWD $f), 'new') }
  }
}
try { & (Join-Path $app 'deploy/windows/publish-release.ps1') -AppDir $app -NodeExe $env:NODE_EXE -SkipSeed }
catch { $failure = $_.ToString() }
@{ failure=$failure; tasks=$tasks } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $app 'result.json') -Encoding utf8
`;

describe.skipIf(process.platform !== "win32" && !process.env.TEST_PWSH)("Windows staged installer", () => {
  it.each(["build", "migration", "register", "start", "health", "success", "fresh"])("handles %s and preserves the role definitions and runtime on failure", async phase => {
    const app = await fixture();
    if (phase === "fresh") {
      for (const dir of ["node_modules", ".next", "dist"]) await rm(path.join(app, dir), { recursive: true });
    }
    await writeFile(path.join(app, ".env.local"), "PORT=4891");
    execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", harness], {
      env: { ...process.env, FIXTURE: app, NODE_EXE: process.execPath, BREAK_AT: phase },
    });
    const result = JSON.parse((await readFile(path.join(app, "result.json"), "utf8")).replace(/^\uFEFF/, ""));
    const committed = phase === "success" || phase === "fresh";
    for (const file of ["node_modules/version", ".next/BUILD_ID", "dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) {
      expect(await readFile(path.join(app, file), "utf8"), result.failure).toBe(committed ? "new" : "old");
    }
    if (committed) {
      expect(result.failure).toBeNull();
      for (const role of roles) expect(result.tasks[role]).toMatchObject({ Xml: "new", State: "Running" });
    } else {
      expect(result.failure).toMatch(({ build: /Next.js build failed/, migration: /Database migration failed/, register: /register failure/, start: /start failure/, health: /did not become ready/ })[phase]!);
      expect(result.tasks[roles[0]!]).toMatchObject({ Xml: "old-web", State: "Running" });
      expect(result.tasks[roles[1]!]).toMatchObject({ Xml: "old-worker", State: "Ready" });
      expect(result.tasks[roles[2]!]).toBeUndefined();
    }
  }, 30000);

  it("generates distinct random aria2 secrets at first install", async () => {
    const secrets: string[] = [];
    for (let i = 0; i < 2; i++) {
      const app = await fixture();
      if (process.platform !== "win32") {
        await symlink(process.execPath, path.join(app, "bin/node.exe"));
        await writeFile(path.join(app, "bin/npm.cmd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      expect(() => execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(app, "deploy/windows/install.ps1"), "-SkipTasks"], {
        stdio: "pipe", env: { ...process.env, PATH: path.join(app, "bin") + path.delimiter + process.env.PATH },
      })).toThrow();
      const env = await readFile(path.join(app, ".env.local"), "utf8");
      const secret = /^ARIA2_RPC_SECRET="([A-Za-z0-9_-]{64})"/m.exec(env)?.[1];
      expect(secret).toBeTruthy();
      secrets.push(secret!);
    }
    expect(new Set(secrets).size).toBe(2);
  }, 30000);
});
