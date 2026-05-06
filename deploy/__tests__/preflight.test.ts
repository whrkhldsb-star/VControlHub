import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

async function runPreflight(args: { appDir: string; envFile?: string; extraEnv?: NodeJS.ProcessEnv }) {
  const repoRoot = path.resolve(__dirname, "../..");
  const script = path.join(repoRoot, "deploy/preflight.sh");

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("bash", [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_DIR: args.appDir,
        ENV_FILE: args.envFile ?? path.join(args.appDir, ".env.local"),
        SKIP_PORT_CHECK: "1",
        ...args.extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeAppDir() {
  const appDir = await mkdtemp(path.join(tmpdir(), "whrkhldsb-preflight-"));
  await writeFile(path.join(appDir, "package.json"), "{}");
  for (const dir of ["storage", "tmp", "uploads", "downloads", "backups", "logs"]) {
    await writeFile(path.join(appDir, dir), "placeholder").catch(async () => undefined);
    await rm(path.join(appDir, dir), { force: true, recursive: true });
  }
  return appDir;
}

describe("deploy/preflight.sh", () => {
  const dbUrlKey = "DATABASE_" + "URL";
  const sessionSecretKey = "AUTH_SESSION_" + "SECRET";
  const initialPasswordKey = "ADMIN_INITIAL_" + "PASSWORD";

  it("fails clearly when the environment file is missing", async () => {
    const appDir = await makeAppDir();
    try {
      const result = await runPreflight({ appDir });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Missing environment file");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("rejects placeholder production secrets without printing secret values", async () => {
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    await writeFile(
      envFile,
      [
        `${dbUrlKey}="REPLACE_WITH_DATABASE_URL"`,
        `${sessionSecretKey}="REPLAC...CRET"`,
        `${initialPasswordKey}="REPLAC...WORD"`,
        "",
      ].join("\n"),
    );
    await chmod(envFile, 0o600);

    try {
      const result = await runPreflight({ appDir, envFile });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("DATABASE_URL still contains a placeholder");
      expect(result.stderr).not.toContain("REPLACE_WITH_SESSION_SECRET");
      expect(result.stderr).not.toContain("REPLACE_WITH_ADMIN_PASSWORD");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("rejects unsafe production demo flags without printing their values", async () => {
    const unsafeFlags = [
      "ENABLE_DEMO_FALLBACK",
      "AUTH_DEMO_FALLBACK",
      "SERVER_DEMO_FALLBACK",
      "STORAGE_DEMO_FALLBACK",
      "COMMAND_DEMO_FALLBACK",
      "SEED_DEMO_DATA",
    ];

    for (const flag of unsafeFlags) {
      const appDir = await makeAppDir();
      const envFile = path.join(appDir, ".env.local");
      await writeFile(
        envFile,
        [
          `${dbUrlKey}="postgresql://preflight_user@127.0.0.1:5432/preflight"`,
          `${sessionSecretKey}="0123456789abcdef0123456789abcdef"`,
          `${initialPasswordKey}="portable_initial_value"`,
          `${flag}="true"`,
          "",
        ].join("\n"),
      );
      await chmod(envFile, 0o600);

      try {
        const result = await runPreflight({ appDir, envFile });
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain(`${flag}=true is unsafe for production`);
        expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
      } finally {
        await rm(appDir, { force: true, recursive: true });
      }
    }
  });

  it("passes for a minimal configured app directory and creates missing runtime directories", async () => {
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    await writeFile(
      envFile,
      [
        `${dbUrlKey}="postgresql://preflight_user@127.0.0.1:5432/preflight"`,
        `${sessionSecretKey}="0123456789abcdef0123456789abcdef"`,
        `${initialPasswordKey}="portable_initial_value"`,
        "ENABLE_DEMO_FALLBACK=false",
        "",
      ].join("\n"),
    );
    await chmod(envFile, 0o600);

    try {
      const result = await runPreflight({ appDir, envFile });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Preflight completed");
      await expect(readFile(path.join(appDir, "storage", ".gitkeep"), "utf8")).resolves.toBe("");
      expect(result.stdout + result.stderr).not.toContain("preflight_pass");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });
  it("upgrade script creates a pre-upgrade backup before delegating to install and check", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const binDir = path.join(appDir, "bin");
    const logFile = path.join(appDir, "calls.log");
    await writeFile(
      envFile,
      [
        `${dbUrlKey}="postgresql://preflight_user@127.0.0.1:5432/preflight"`,
        `${sessionSecretKey}="0123456789abcdef0123456789abcdef"`,
        `${initialPasswordKey}="portable_initial_value"`,
        "",
      ].join("\n"),
    );
    await chmod(envFile, 0o600);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir, { recursive: true }));
    await writeFile(
      path.join(binDir, "pg_dump"),
      `#!/usr/bin/env bash\nprintf 'backup\\n'\nprintf 'backup\\n' >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "rsync"),
      `#!/usr/bin/env bash\nprintf 'rsync\\n' >> ${JSON.stringify(logFile)}\nsrc=""\ndest=""\nfor arg in "$@"; do\n  case "$arg" in\n    --*) ;;\n    *) src="$dest"; dest="$arg" ;;\n  esac\ndone\nmkdir -p "$dest/deploy/systemd"\nprintf '[Unit]\\nWorkingDirectory=/tmp\\nEnvironmentFile=/tmp/.env\\nUser=root\\nGroup=root\\n[Service]\\nExecStart=/bin/true\\n' > "$dest/deploy/systemd/whrkhldsb-next.service.example"\nprintf '[Unit]\\nWorkingDirectory=/tmp\\nEnvironmentFile=/tmp/.env\\nUser=root\\nGroup=root\\n[Service]\\nExecStart=/bin/true\\n' > "$dest/deploy/systemd/whrkhldsb-ssh-ws.service.example"\n`,
    );
    await writeFile(path.join(binDir, "npm"), `#!/usr/bin/env bash\nprintf 'npm %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "systemctl"), `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "install"), `#!/usr/bin/env bash\nprintf 'install %s\\n' "$*" >> ${JSON.stringify(logFile)}\n/bin/install "$@"\n`);
    for (const command of ["pg_dump", "rsync", "npm", "systemctl", "install"]) {
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn("bash", [path.join(repoRoot, "deploy/upgrade.sh")], {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            APP_DIR: appDir,
            ENV_FILE: envFile,
            SKIP_PACKAGES: "1",
            SKIP_RESTART: "1",
            SKIP_POST_CHECK: "1",
          },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
      expect(result.code).toBe(0);
      await expect(readFile(logFile, "utf8")).resolves.toContain("backup");
      expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

});
