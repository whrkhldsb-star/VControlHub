// @vitest-environment node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const pwsh = process.env.TEST_PWSH || "powershell.exe";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const app = realpathSync.native(await mkdtemp(path.join(tmpdir(), "vch-win-install-")));
  roots.push(app);
  for (const dir of ["deploy", "deploy/windows", "deploy/lib", "node_modules", ".next", "dist", "bin"]) await mkdir(path.join(app, dir));
  for (const file of ["windows/install.ps1", "windows/publish-release.ps1", "windows/read-install-env.mjs", "lib/release-directories.txt", "check-aria2-secret.mjs", "check-node-version.mjs", "env.production.example"]) {
    await copyFile(path.resolve("deploy", file), path.join(app, "deploy", file));
  }
  await writeFile(path.join(app, "deploy/windows/run.ps1"), "# versioned fixture runner");
  await mkdir(path.join(app, "public"));
  await writeFile(path.join(app, "public/version"), "new");
  await writeFile(path.join(app, "deploy/check-upgrade-migrations.mjs"), "process.exit(0)");
  for (const artifact of ["node_modules/version", ".next/BUILD_ID", "dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) await writeFile(path.join(app, artifact), "old");
  return app;
}

const roles = ["VControlHub Web", "VControlHub Worker", "VControlHub SSH WS"];
// Exercise the real build, switching, and rollback control flow using a task
// scheduler in memory. Filesystem moves and the readiness probe run in PowerShell.
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
if ($env:PREVIOUS_RELEASE) {
  $legacyRunner = Join-Path (Join-Path $app 'deploy/windows') 'run.ps1'
  foreach ($task in $tasks.Values) {
    $task.Xml = '<Task><Actions><Exec><Arguments>-File &quot;' + [Security.SecurityElement]::Escape($legacyRunner) + '&quot;</Arguments></Exec></Actions></Task>'
  }
}
# Scheduler fixtures exercise cutover. The Windows-only test checks the live ACL policy.
function Assert-MaintenancePath($Path,[switch]$Tree) { }
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
try { & (Join-Path $app 'deploy/windows/publish-release.ps1') -AppDir $app -NodeExe $env:NODE_EXE -SkipSeed -PreviousRelease $env:PREVIOUS_RELEASE }
catch { $failure = $_.ToString() }
@{ failure=$failure; tasks=$tasks } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $app 'result.json') -Encoding utf8
`;

describe.skipIf(process.platform !== "win32" && !process.env.TEST_PWSH)("Windows staged installer", () => {
  it.each(["build", "migration", "register", "start", "health", "success", "fresh"])("handles %s and preserves the role definitions and runtime on failure", async phase => {
    const app = await fixture();
    if (phase === "fresh") {
      for (const dir of ["node_modules", ".next", "dist"]) await rm(path.join(app, dir), { recursive: true });
    }
    const keys = ["AUTH_SESSION_SECRET", "SSH_WS_SECRET", "STORAGE_DIRECT_ACCESS_SECRET", "ARIA2_RPC_SECRET", "ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD"];
    await writeFile(path.join(app, ".env.local"), ["PORT=4891", "NEXT_HOST=::1", "DATABASE_URL=postgresql://localhost/windows_test",
      ...keys.map(key => key + "=fixture-value")].join("\n"));
    const env = { ...process.env };
    for (const key of [...keys, "DATABASE_URL", "SSH_WS_PORT"]) delete env[key];
    execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", harness], {
      env: { ...env,
        FIXTURE: app, NODE_EXE: process.execPath, BREAK_AT: phase },
    });
    const result = JSON.parse((await readFile(path.join(app, "result.json"), "utf8")).replace(/^\uFEFF/, ""));
    const committed = phase === "success" || phase === "fresh";
    const releaseDir = path.join(app, ".vch-releases");
    const versions = await readdir(releaseDir).catch(() => []);
    expect(versions.length).toBe(committed ? 1 : 0);
    const runtime = committed ? path.join(releaseDir, versions[0]!) : app;
    if (committed) expect(await readFile(path.join(runtime, "public/version"), "utf8")).toBe("new");
    for (const file of ["node_modules/version", ".next/BUILD_ID", "dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) {
      expect(await readFile(path.join(runtime, file), "utf8"), result.failure).toBe(committed ? "new" : "old");
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

  it("keeps real backup members and restores all program files after a second release fails", async () => {
    const app = await fixture();
    const env = { ...process.env };
    const keys = ["DATABASE_URL", "AUTH_SESSION_SECRET", "SSH_WS_SECRET", "STORAGE_DIRECT_ACCESS_SECRET", "ARIA2_RPC_SECRET", "ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD"];
    for (const key of [...keys, "SSH_WS_PORT", "IMAGE_UPLOAD_DIR"]) delete env[key];
    await writeFile(path.join(app, ".env.local"), ["PORT=4891", "NEXT_HOST=::1", "IMAGE_UPLOAD_DIR=./photos",
      ...keys.map(key => key + "=" + (key === "DATABASE_URL" ? "postgresql://localhost/windows_test" : "fixture-value"))].join("\n"));
    for (const dir of ["storage", "photos", "scripts"]) await mkdir(path.join(app, dir));
    await writeFile(path.join(app, "storage/item"), "data");
    await writeFile(path.join(app, "photos/image"), "original");
    const helper = "scripts/backup.mjs";
    await writeFile(path.join(app, helper), "old helper");
    const publish = async (phase: string) => {
      execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", harness], {
        env: { ...env, FIXTURE: app, NODE_EXE: process.execPath, BREAK_AT: phase },
      });
      return JSON.parse((await readFile(path.join(app, "result.json"), "utf8")).replace(/^\uFEFF/, ""));
    };
    expect((await publish("fresh")).failure).toBeNull();
    const live = path.join(app, ".vch-releases/current");
    expect((await lstat(path.join(live, "storage"))).isDirectory()).toBe(true);
    expect(await readFile(path.join(live, "storage/item"), "utf8")).toBe("data");
    await writeFile(path.join(app, helper), "new helper");
    await writeFile(path.join(app, ".env.local"), (await readFile(path.join(app, ".env.local"), "utf8")) + "\nNEW_VERSION=1");
    await writeFile(path.join(app, "public/version"), "changed");
    await writeFile(path.join(app, "upgrade-only"), "new");
    await writeFile(path.join(app, "photos/image"), "saved before cutover");
    expect((await publish("health")).failure).toMatch(/did not become ready/);
    expect(await readFile(path.join(live, helper), "utf8")).toBe("old helper");
    expect(await readFile(path.join(live, "public/version"), "utf8")).toBe("new");
    expect(await readFile(path.join(live, ".env.local"), "utf8")).not.toContain("NEW_VERSION");
    await expect(lstat(path.join(live, "upgrade-only"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(live, "photos/image"), "utf8")).toBe("saved before cutover");
    expect((await publish("success")).failure).toBeNull();
    expect(await readFile(path.join(live, helper), "utf8")).toBe("new helper");
    expect(await readFile(path.join(app, "storage/item"), "utf8")).toBe("data");
  }, 30000);

  it.each(["build", "migration", "health"])("restores the complete legacy version when %s fails", async phase => {
    const app = await fixture();
    const prior = await fixture();
    const keys = ["AUTH_SESSION_SECRET", "SSH_WS_SECRET", "STORAGE_DIRECT_ACCESS_SECRET", "ARIA2_RPC_SECRET", "ENCRYPTION_KEY", "ADMIN_INITIAL_PASSWORD"];
    const env = { ...process.env };
    for (const key of [...keys, "DATABASE_URL", "SSH_WS_PORT"]) delete env[key];
    for (const dir of [app, prior]) {
      await mkdir(path.join(dir, "scripts"));
      await writeFile(path.join(dir, "scripts/backup.mjs"), dir === prior ? "previous helper" : "replacement helper");
      await writeFile(path.join(dir, ".env.local"), ["PORT=4891", "NEXT_HOST=::1", "DATABASE_URL=postgresql://localhost/windows_test",
        ...keys.map(key => key + "=fixture-value")].join("\n"));
    }
    await writeFile(path.join(prior, "public/version"), "previous public");
    execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", harness], {
      env: { ...env, FIXTURE: app, NODE_EXE: process.execPath, BREAK_AT: phase, PREVIOUS_RELEASE: prior },
    });
    const result = JSON.parse((await readFile(path.join(app, "result.json"), "utf8")).replace(/^\uFEFF/, ""));
    expect(result.failure).toBeTruthy();
    const restored = result.tasks[roles[0]!];
    expect(restored.State).toBe("Running");
    expect(restored.Xml.replaceAll("\\", "/")).toContain(prior.replaceAll("\\", "/") + "/deploy/windows/run.ps1");
    expect(await readFile(path.join(prior, "scripts/backup.mjs"), "utf8")).toBe("previous helper");
    expect(await readFile(path.join(prior, "public/version"), "utf8")).toBe("previous public");
  }, 30000);

  it.skipIf(process.platform !== "win32")("rejects an ordinary users' writable directory for SYSTEM tasks", async () => {
    const app = await fixture();
    execFileSync("icacls.exe", [app, "/grant", "*S-1-5-32-545:(OI)(CI)M"]);
    const script = '. $env:TRUST_CHECK; try { Assert-MaintenancePath $env:FIXTURE } catch { exit 23 }; exit 0';
    expect(() => execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, FIXTURE: app, TRUST_CHECK: path.resolve("deploy/windows/install.ps1") },
    })).toThrow(expect.objectContaining({ status: 23 }));
  });

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
