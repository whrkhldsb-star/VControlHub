// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "linux")("installed health endpoints", () => {
  it("reads the installed custom port and formats the IPv6 loopback URL for drift checks", async () => {
    const app = await mkdtemp(path.join(tmpdir(), "vch-drift-"));
    roots.push(app);
    for (const dir of ["bin", ".next", "dist"]) await mkdir(path.join(app, dir));
    for (const file of [".next/BUILD_ID", "dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) await writeFile(path.join(app, file), "ok");
    await writeFile(path.join(app, ".env.runtime"), "NEXT_HOST=::1\n");
    await writeFile(path.join(app, ".env.local"), 'NEXT_PORT="4891"\n');
    await writeFile(path.join(app, "bin/systemctl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await writeFile(path.join(app, "bin/curl"), '#!/bin/sh\necho "$*" > "$APP_DIR/probe"\necho 200\n', { mode: 0o755 });
    execFileSync("bash", ["deploy/drift-check.sh"], { env: { ...process.env, APP_DIR: app, PATH: app + "/bin:" + process.env.PATH } });
    expect(await readFile(path.join(app, "probe"), "utf8")).toContain("http://[::1]:4891/login");
  });

  it.each([["http", "localhost"], ["full", "192.0.2.42"]])("continues past loopback-only origins in %s mode", async (scope, expected) => {
    const app = await mkdtemp(path.join(tmpdir(), "vch-smoke-fallback-"));
    roots.push(app);
    const script = await readFile("deploy/smoke-test.sh", "utf8");
    await writeFile(path.join(app, ".env.local"), 'SSH_WS_ALLOWED_ORIGINS="http://127.0.0.1:3000,http://localhost:3000,http://[::1]:3000"\n');
    const preamble = script.slice(0, script.indexOf("PASS=0"));
    const probeScript = path.join(app, "probe.sh");
    await mkdir(path.join(app, "lib"));
    await writeFile(path.join(app, "lib/listen-address.sh"), await readFile("deploy/lib/listen-address.sh"));
    await writeFile(probeScript, 'ip() { echo "    inet 192.0.2.42/24"; }\n' + preamble + '\nprintf "%s" "$TARGET"');
    const output = execFileSync("bash", [probeScript], {
      encoding: "utf8", env: { ...process.env, APP_DIR: app, SMOKE_SCOPE: scope },
    });
    expect(output).toBe(expected);
  });

  it("formats IPv6 readiness URLs via web_health_url in install.sh restart_services", async () => {
    const app = await mkdtemp(path.join(tmpdir(), "vch-install-health-"));
    roots.push(app);
    const runtimeEnv = path.join(app, ".env.runtime");
    await writeFile(runtimeEnv, "NEXT_HOST=::1\nNEXT_PORT=3000\n");
    const installScript = await readFile("deploy/install.sh", "utf8");
    expect(installScript).toContain('curl -fsS "$(web_health_url "${APP_DIR}" "${RUNTIME_ENV_FILE}")"');
    const url = execFileSync(
      "bash",
      ["-c", 'source deploy/lib/listen-address.sh; NEXT_HOST="::" NEXT_PORT="3456" web_health_url "$1" "$2"', "--", app, runtimeEnv],
      { encoding: "utf8" },
    );
    expect(url).toBe("http://[::1]:3456/login");
  });
});
