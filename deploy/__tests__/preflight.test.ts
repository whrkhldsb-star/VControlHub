import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function runScript(script: string, args: { cwd: string; env: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("bash", [script], { cwd: args.cwd, env: args.env });
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

async function runPreflight(args: { appDir: string; envFile?: string; extraEnv?: NodeJS.ProcessEnv }) {
  const repoRoot = path.resolve(__dirname, "../..");
  const script = path.join(repoRoot, "deploy/preflight.sh");

  return runScript(script, {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_DIR: args.appDir,
      ENV_FILE: args.envFile ?? path.join(args.appDir, ".env.local"),
      SKIP_PORT_CHECK: "1",
      ...args.extraEnv,
    },
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

async function writeValidEnv(envFile: string, extraLines: string[] = []) {
  const dbUrlKey = "DATABASE_" + "URL";
  const sessionSecretKey = "AUTH_SESSION_" + "SECRET";
  const initialPasswordKey = "ADMIN_INITIAL_" + "PASSWORD";
  await writeFile(
    envFile,
    [
      `${dbUrlKey}="postgresql://preflight_user@127.0.0.1:5432/preflight"`,
      `${sessionSecretKey}="0123456789abcdef0123456789abcdef"`,
      `${initialPasswordKey}="portable_initial_value"`,
      ...extraLines,
      "",
    ].join("\n"),
  );
  await chmod(envFile, 0o600);
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
        `${sessionSecretKey}="REPLACE_WITH_AUTH_VALUE"`,
        `${initialPasswordKey}="REPLACE_WITH_ADMIN_VALUE"`,
        "",
      ].join("\n"),
    );
    await chmod(envFile, 0o600);

    try {
      const result = await runPreflight({ appDir, envFile });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("DATABASE_URL still contains a placeholder");
      expect(result.stderr).not.toContain("REPLACE_WITH_AUTH_VALUE");
      expect(result.stderr).not.toContain("REPLACE_WITH_ADMIN_VALUE");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("rejects unsafe production demo flags without printing unrelated secret values", async () => {
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
      await writeValidEnv(envFile, [
        "ENABLE_DEMO_FALLBACK=false",
        `${flag}=true`,
      ]);

      try {
        const result = await runPreflight({ appDir, envFile });
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain(`${flag}=true`);
        expect(result.stderr).toContain("unsafe for production");
        expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
      } finally {
        await rm(appDir, { force: true, recursive: true });
      }
    }
  });

  it("passes with production-safe required env and creates runtime directories", async () => {
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    await writeValidEnv(envFile, ["ENABLE_DEMO_FALLBACK=false"]);

    try {
      const result = await runPreflight({ appDir, envFile });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Preflight completed");
      await expect(readFile(path.join(appDir, "storage", ".gitkeep"), "utf8")).resolves.toBe("");
      expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
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
    await writeValidEnv(envFile);
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, "pg_dump"), `#!/usr/bin/env bash\nprintf 'backup %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "gzip"), "#!/usr/bin/env bash\ncat\n");
    await writeFile(path.join(binDir, "du"), "#!/usr/bin/env bash\nprintf '1K\\t%s\\n' \"$2\"\n");
    await writeFile(path.join(binDir, "find"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(path.join(binDir, "rsync"), `#!/usr/bin/env bash\nprintf 'rsync %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await mkdir(path.join(appDir, "scripts"), { recursive: true });
    await mkdir(path.join(appDir, "deploy/systemd"), { recursive: true });
    await writeFile(path.join(appDir, "scripts/backup-db.sh"), `#!/usr/bin/env bash\nprintf 'backup %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(appDir, "deploy/systemd/whrkhldsb-next.service.example"), "[Unit]\nWorkingDirectory=/tmp\nEnvironmentFile=/tmp/.env\nUser=root\nGroup=root\n[Service]\nExecStart=/bin/true\n");
    await writeFile(path.join(appDir, "deploy/systemd/whrkhldsb-ssh-ws.service.example"), "[Unit]\nWorkingDirectory=/tmp\nEnvironmentFile=/tmp/.env\nUser=root\nGroup=root\n[Service]\nExecStart=/bin/true\n");
    await chmod(path.join(appDir, "scripts/backup-db.sh"), 0o755);
    await writeFile(path.join(binDir, "npm"), `#!/usr/bin/env bash\nprintf 'npm %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "systemctl"), `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "install"), `#!/usr/bin/env bash\nprintf 'install %s\\n' "$*" >> ${JSON.stringify(logFile)}\n/bin/install "$@"\n`);
    for (const command of ["pg_dump", "gzip", "du", "find", "rsync", "npm", "systemctl", "install"]) {
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/upgrade.sh"), {
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
      expect(result.code, result.stdout + result.stderr).toBe(0);
      await expect(readFile(logFile, "utf8")).resolves.toContain("backup");
      expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });
});

describe("deploy/install.sh", () => {
  it("writes systemd units with detected npm, npx, and node PATH for non-standard Node installs", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const fakeRoot = path.join(appDir, "fake-root");
    const binDir = path.join(appDir, "bin");
    const customNodeDir = path.join(appDir, "custom-node");
    const logFile = path.join(appDir, "calls.log");
    await writeValidEnv(envFile);
    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(customNodeDir, { recursive: true }),
      mkdir(path.join(fakeRoot, "etc/systemd/system"), { recursive: true }),
      mkdir(path.join(fakeRoot, "etc/caddy"), { recursive: true }),
    ]);

    await writeFile(path.join(customNodeDir, "node"), "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n");
    await writeFile(path.join(customNodeDir, "npm"), `#!/usr/bin/env bash\nprintf 'npm %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(customNodeDir, "npx"), `#!/usr/bin/env bash\nprintf 'npx %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);

    await writeFile(path.join(binDir, "id"), "#!/usr/bin/env bash\nif [ \"$1\" = \"-u\" ]; then printf '0\\n'; else exit 1; fi\n");
    await writeFile(path.join(binDir, "useradd"), `#!/usr/bin/env bash\nprintf 'useradd %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "apt-get"), `#!/usr/bin/env bash\nprintf 'apt-get %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
    await writeFile(path.join(binDir, "curl"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(path.join(binDir, "gpg"), "#!/usr/bin/env bash\ncat >/dev/null\n");
    await writeFile(path.join(binDir, "chown"), `#!/usr/bin/env bash\nprintf 'chown %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
	await writeFile(path.join(binDir, "systemctl"), `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`);
	await writeFile(path.join(binDir, "sed"), "#!/usr/bin/env bash\n/bin/sed \"$@\"");
	await writeFile(path.join(binDir, "install"), "#!/usr/bin/env bash\n/bin/install \"$@\"");
	await writeFile(path.join(binDir, "caddy"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(path.join(binDir, "rsync"), `#!/usr/bin/env bash\nsrc=""\ndest=""\nfor arg in "$@"; do\n  case "$arg" in\n    --*) ;;\n    *) src="$dest"; dest="$arg" ;;\n  esac\ndone\nmkdir -p "$dest"\n(cd "$src" && tar --exclude=.git --exclude=node_modules --exclude=.next --exclude=backups --exclude=storage --exclude=tmp --exclude=uploads --exclude=downloads --exclude=logs --exclude=.env.local -cf - .) | (cd "$dest" && tar -xf -)\n`);
    await writeFile(path.join(binDir, "git"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(path.join(binDir, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    for (const command of ["node", "npm", "npx"]) await chmod(path.join(customNodeDir, command), 0o755);
    for (const command of ["id", "useradd", "apt-get", "curl", "gpg", "chown", "systemctl", "sed", "install", "caddy", "rsync", "git", "sleep"]) {
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${customNodeDir}:/usr/bin:/bin`,
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SOURCE_DIR: repoRoot,
          APP_NAME: "custom-console",
          APP_USER: "portable-app",
          DOMAIN: "portable.example.test",
		SERVICE_PREFIX: "customsvc",
		SITE_NAME: "自定义控制台",
		DESTDIR: fakeRoot,
		SKIP_PACKAGES: "1",
		SKIP_RESTART: "1",
        },
      });

      expect(result.code).toBe(0);
      const nextUnitPath = path.join(fakeRoot, "etc/systemd/system/customsvc-next.service");
      const wsUnitPath = path.join(fakeRoot, "etc/systemd/system/customsvc-ssh-ws.service");
      const nextUnit = await readFile(nextUnitPath, "utf8");
      const wsUnit = await readFile(wsUnitPath, "utf8");
	expect(nextUnit).toContain(`Environment=PATH=${customNodeDir}`);
	expect(nextUnit).toContain(`ExecStart=/usr/bin/env node ${appDir}/.next/standalone/server.js`);
	expect(nextUnit).toContain("Description=自定义控制台 Next.js application");
	expect(wsUnit).toContain(`Environment=PATH=${customNodeDir}`);
	expect(wsUnit).toContain(`ExecStart=${path.join(customNodeDir, "npx")} tsx src/ssh-ws-proxy.ts`);
      expect(wsUnit).toContain("Description=自定义控制台 SSH WebSocket proxy");
      expect(result.stdout + result.stderr).not.toContain("portable_initial_value");
      expect(result.stdout + result.stderr).not.toContain("whrkhldsb-next.service");
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("defaults to root for in-place deployments under /root unless APP_USER is explicit", async () => {
    const script = await readFile(path.resolve(__dirname, "../install.sh"), "utf8");
    expect(script).toContain("APP_USER_EXPLICIT");
    expect(script).toContain("/root|/root/*");
    expect(script).toContain('APP_USER="root"');
  });
});


describe("compressed archive deployment entrypoints", () => {
  it("includes a root one-click installer and archive packaging script", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const rootInstaller = path.join(repoRoot, "install.sh");
    const archiveScript = path.join(repoRoot, "deploy/package.sh");

    await expect(access(rootInstaller)).resolves.toBeUndefined();
    await expect(access(archiveScript)).resolves.toBeUndefined();

    for (const script of [rootInstaller, archiveScript]) {
      const result = await runScript(script, {
        cwd: repoRoot,
        env: { ...process.env, CHECK_SYNTAX_ONLY: "1" },
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
    }

    const installer = await readFile(rootInstaller, "utf8");
    const packager = await readFile(archiveScript, "utf8");
    expect(installer).toContain("SOURCE_DIR");
    expect(installer).toContain("deploy/install.sh");
    expect(packager).toContain(".env.local");
    expect(packager).toContain("node_modules");
    expect(packager).toContain("${APP_SLUG}-release");
  });

  it("lets release archives use a custom portable app slug and package root", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const outputDir = await mkdtemp(path.join(tmpdir(), "portable-release-"));
    const archiveScript = path.join(repoRoot, "deploy/package.sh");

    try {
      const result = await runScript(archiveScript, {
        cwd: repoRoot,
        env: {
          ...process.env,
          APP_NAME: "我的 控制台",
          APP_SLUG: "my-console",
          PACKAGE_ROOT_NAME: "my-console-bundle",
          OUTPUT_DIR: outputDir,
          STAMP: "portabletest",
        },
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(path.join(outputDir, "my-console-release-portabletest.tar.gz"));

      const listing = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn("tar", ["-tzf", path.join(outputDir, "my-console-release-portabletest.tar.gz")]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
      expect(listing.code, listing.stderr).toBe(0);
      expect(listing.stdout).toContain("my-console-bundle/./install.sh");
      expect(listing.stdout).not.toContain("whrkhldsb-release/");
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });
});
