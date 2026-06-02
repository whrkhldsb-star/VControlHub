import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function runScript(
  script: string,
  args: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    args?: string[];
    timeoutMs?: number;
  },
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn("bash", [script, ...(args.args ?? [])], {
        cwd: args.cwd,
        env: args.env,
      });
      const timer = args.timeoutMs
        ? setTimeout(() => {
            child.kill("SIGTERM");
          }, args.timeoutMs)
        : undefined;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    },
  );
}

async function runPreflight(args: {
  appDir: string;
  envFile?: string;
  extraEnv?: NodeJS.ProcessEnv;
}) {
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
  for (const dir of [
    "storage",
    "tmp",
    "uploads",
    "downloads",
    "backups",
    "logs",
  ]) {
    await writeFile(path.join(appDir, dir), "placeholder").catch(
      async () => undefined,
    );
    await rm(path.join(appDir, dir), { force: true, recursive: true });
  }
  return appDir;
}

async function writeValidEnv(envFile: string, extraLines: string[] = []) {
  const dbUrlKey = "DATABASE_" + "URL";
  const sessionSecretKey = "AUTH_SESSION_" + "SECRET";
  const initialPasswordKey = "ADMIN_INITIAL_" + "PASSWORD";
  const sshWsSecretKey = "SSH_WS_" + "SECRET";
  const encryptionKey = "ENCRYPTION_" + "KEY";
  await writeFile(
    envFile,
    [
      `${dbUrlKey}="postgresql://preflight_user@127.0.0.1:5432/preflight"`,
      `${sessionSecretKey}="0123456789abcdef0123456789abcdef"`,
      `${initialPasswordKey}="portable_initial_value"`,
      `${sshWsSecretKey}="0123456789abcdef0123456789abcdef"`,
      `${encryptionKey}="abcdef0123456789abcdef0123456789"`,
      ...extraLines,
      "",
    ].join("\n"),
  );
  await chmod(envFile, 0o600);
}

describe("deploy/check.sh", () => {
  it("can run static checks before services are restarted", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    await writeValidEnv(envFile);
    await Promise.all([
      mkdir(path.join(appDir, "dist"), { recursive: true }),
      mkdir(path.join(appDir, "storage"), { recursive: true }),
      mkdir(path.join(appDir, "tmp"), { recursive: true }),
      mkdir(path.join(appDir, "uploads"), { recursive: true }),
      mkdir(path.join(appDir, "downloads"), { recursive: true }),
      mkdir(path.join(appDir, "backups"), { recursive: true }),
      mkdir(path.join(appDir, "logs"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(appDir, "dist/server.js"), "console.log('server')\n"),
      writeFile(
        path.join(appDir, "dist/ssh-ws-proxy.js"),
        "console.log('ssh-ws')\n",
      ),
    ]);

    try {
      const result = await runScript(path.join(repoRoot, "deploy/check.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SKIP_LIVE_CHECKS: "1",
        },
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toContain("Skipping live service and HTTP checks");
      expect(result.stdout).toContain("Check completed");
      expect(result.stdout + result.stderr).not.toContain(
        "portable_initial_value",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });
});
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
      expect(result.stderr).toContain(
        "DATABASE_URL still contains a placeholder",
      );
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
        expect(result.stdout + result.stderr).not.toContain(
          "portable_initial_value",
        );
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
      await expect(
        readFile(path.join(appDir, "storage", ".gitkeep"), "utf8"),
      ).resolves.toBe("");
      expect(result.stdout + result.stderr).not.toContain(
        "portable_initial_value",
      );
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
    await writeFile(
      path.join(binDir, "pg_dump"),
      `#!/usr/bin/env bash\nprintf 'backup %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(path.join(binDir, "gzip"), "#!/usr/bin/env bash\ncat\n");
    await writeFile(
      path.join(binDir, "du"),
      "#!/usr/bin/env bash\nprintf '1K\\t%s\\n' \"$2\"\n",
    );
    await writeFile(path.join(binDir, "find"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(
      path.join(binDir, "rsync"),
      `#!/usr/bin/env bash\nprintf 'rsync %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "id"),
      '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n',
    );
    await writeFile(
      path.join(binDir, "useradd"),
      `#!/usr/bin/env bash\nprintf 'unexpected useradd %s\\n' "$*" >> ${JSON.stringify(logFile)}\nexit 99\n`,
    );
    await writeFile(path.join(binDir, "chown"), "#!/usr/bin/env bash\nexit 0\n");
    await mkdir(path.join(appDir, "scripts"), { recursive: true });
    await mkdir(path.join(appDir, "deploy/systemd"), { recursive: true });
    await mkdir(path.join(appDir, "deploy"), { recursive: true });
    await writeFile(
      path.join(appDir, "scripts/backup-db.sh"),
      `#!/usr/bin/env bash\nprintf 'backup %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-next.service.example"),
      "[Unit]\nDescription=test next\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{RUNTIME_ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-ssh-ws.service.example"),
      "[Unit]\nDescription=test ws\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{RUNTIME_ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/apache-next-proxy.example.conf"),
      "<VirtualHost *:80>\nServerName {{SERVER_NAME}}\nProxyPass / http://{{NEXT_HOST}}:{{NEXT_PORT}}/\nProxyPass /ssh ws://{{SSH_WS_HOST}}:{{SSH_WS_PORT}}/\n</VirtualHost>\n",
    );
    await chmod(path.join(appDir, "scripts/backup-db.sh"), 0o755);
    await writeFile(
      path.join(binDir, "npm"),
      `#!/usr/bin/env bash\nprintf 'npm %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "systemctl"),
      `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "install"),
      `#!/usr/bin/env bash\nprintf 'install %s\\n' "$*" >> ${JSON.stringify(logFile)}\n/bin/install "$@"\n`,
    );
    await writeFile(
      path.join(binDir, "a2enmod"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await writeFile(
      path.join(binDir, "ip"),
      '#!/usr/bin/env bash\nprintf "31.59.111.31\\n"\n',
    );
    await writeFile(
      path.join(binDir, "apache2"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await writeFile(
      path.join(binDir, "apachectl"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    for (const command of [
      "pg_dump",
      "gzip",
      "du",
      "find",
      "rsync",
      "id",
      "useradd",
      "chown",
      "npm",
      "systemctl",
      "install",
      "a2enmod",
      "ip",
      "apache2",
      "apachectl",
    ]) {
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
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
          DESTDIR: path.join(appDir, "fake-root"),
          INSTALL_SYSTEMD_UNITS: "1",
        },
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
      await expect(readFile(logFile, "utf8")).resolves.toContain("backup");
      expect(result.stdout + result.stderr).not.toContain(
        "portable_initial_value",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("refuses to install systemd templates with service keys under Unit", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const fakeRoot = path.join(appDir, "fake-root");
    const binDir = path.join(appDir, "bin");
    await writeValidEnv(envFile);
    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(path.join(fakeRoot, "etc/systemd/system"), { recursive: true }),
      mkdir(path.join(appDir, "deploy/systemd"), { recursive: true }),
    ]);

    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-next.service.example"),
      "[Unit]\nWorkingDirectory=/tmp\n[Service]\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-ssh-ws.service.example"),
      "[Unit]\nDescription=ok\n[Service]\nExecStart=/bin/true\n",
    );
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "install",
      "caddy",
      "rsync",
      "git",
      "sleep",
      "systemctl",
      "node",
      "npm",
      "npx",
      "systemd-analyze",
      "systemctl",
    ]) {
      let body = "#!/usr/bin/env bash\nexit 0\n";
      if (command === "id")
        body =
          '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n';
      if (command === "node")
        body =
          "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n";
      await writeFile(path.join(binDir, command), body);
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:/usr/bin:/bin`,
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SOURCE_DIR: repoRoot,
          DESTDIR: fakeRoot,
          SKIP_PACKAGES: "1",
          SKIP_RESTART: "1",
          INSTALL_SYSTEMD_UNITS: "1",
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
        },
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        "service-only keys must be under [Service]",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });
});

describe("deploy/install.sh", () => {
  it("installs and enables Docker Engine during normal first install unless explicitly skipped", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const script = await readFile(path.join(repoRoot, "deploy/install.sh"), "utf8");

    expect(script).toContain('SKIP_DOCKER="${SKIP_DOCKER:-0}"');
    expect(script).toContain("install_docker() {");
    expect(script).toContain("apt-get install -y docker.io");
    expect(script).toContain("systemctl enable --now docker");
    expect(script).toContain("docker info");
    expect(script).toContain("Skipping Docker Engine installation (SKIP_DOCKER=1)");
    expect(script).toContain("Skipping Docker Engine installation for DESTDIR isolated install");
    expect(script).toMatch(/need_root\s+install_packages\s+install_docker\s+prepare_app_user/);
  });

  it("syncs generated env identity and database settings with installer overrides", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const fakeRoot = path.join(appDir, "fake-root");
    const binDir = path.join(appDir, "bin");
    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(path.join(fakeRoot, "etc/systemd/system"), { recursive: true }),
      mkdir(path.join(appDir, "deploy/systemd"), { recursive: true }),
    ]);
    await writeFile(
      path.join(appDir, "deploy/env.production.example"),
      [
        'APP_SLUG="whrkhldsb"',
        'PG_DB_NAME="whrkhldsb"',
        'PG_DB_USER="whrkhldsb"',
        'NEXT_PORT="3000"',
        'SSH_WS_PORT="3001"',
        'DATABASE_URL="postgresql://smoke_console:smoke_pw@127.0.0.1:5432/smoke_console"',
        'AUTH_SESSION_SECRET="REPLACE_WITH_AUTH_SESSION_SECRET"',
        'ADMIN_INITIAL_PASSWORD="REPLACE_WITH_ADMIN_INITIAL_PASSWORD"',
        'SSH_WS_SECRET="REPLACE_WITH_SSH_WS_SECRET"',
        'ARIA2_RPC_SECRET="REPLACE_WITH_ARIA2_RPC_SECRET"',
        'ENCRYPTION_KEY="REPLACE_WITH_ENCRYPTION_KEY"',
        'SSH_WS_ALLOWED_ORIGINS="REPLACE_WITH_ORIGINS"',
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-next.service.example"),
      "[Unit]\nDescription=test next\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-ssh-ws.service.example"),
      "[Unit]\nDescription=test ws\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/apache-next-proxy.example.conf"),
      "[VirtualHost *:80]\nServerName {{SERVER_NAME}}\nProxyPass / http://{{NEXT_HOST}}:{{NEXT_PORT}}/\nProxyPassReverse / http://{{NEXT_HOST}}:{{NEXT_PORT}}/\n",
    );
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "install",
      "rsync",
      "git",
      "sleep",
      "systemd-analyze",
      "systemctl",
      "systemctl",
      "node",
      "npm",
      "npx",
      "openssl",
      "ip",
      "apache2",
      "apachectl",
      "a2enmod",
      "a2dissite",
      "a2ensite",
      "apache2ctl",
    ]) {
      let body = "#!/usr/bin/env bash\nexit 0\n";
      if (command === "id")
        body =
          '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n';
      if (command === "node")
        body =
          "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n";
      if (command === "openssl")
        body =
          "#!/usr/bin/env bash\nprintf '0123456789abcdef0123456789abcdef0123456789abcdef'\n";
      await writeFile(path.join(binDir, command), body);
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:/usr/bin:/bin`,
          APP_NAME: "smoke-console",
          APP_SLUG: "smoke-console",
          SERVICE_PREFIX: "smoke-console",
          DOMAIN: "smoke.example.test",
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SOURCE_DIR: repoRoot,
          DESTDIR: fakeRoot,
          SKIP_PACKAGES: "1",
          SKIP_RESTART: "1",
          INSTALL_SYSTEMD_UNITS: "1",
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
          PG_DB_NAME: "smoke_console",
          PG_DB_USER: "smoke_console",
          NEXT_PORT: "3100",
          SSH_WS_PORT: "3101",
        },
        timeoutMs: 20000,
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      const envContent = await readFile(envFile, "utf8");
      expect(envContent).toContain('APP_SLUG="smoke-console"');
      expect(envContent).toContain('PG_DB_NAME="smoke_console"');
      expect(envContent).toContain('PG_DB_USER="smoke_console"');
      expect(envContent).toContain('NEXT_PORT="3100"');
      expect(envContent).toContain('PORT="3100"');
      expect(envContent).toContain('SSH_WS_PORT="3101"');
      expect(envContent).toContain(
        'ARIA2_RPC_SECRET="0123456789abcdef0123456789abcdef0123456789abcdef"',
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  }, 30000);

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

    await writeFile(
      path.join(customNodeDir, "node"),
      "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n",
    );
    await writeFile(
      path.join(customNodeDir, "npm"),
      `#!/usr/bin/env bash\nprintf 'npm %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(customNodeDir, "npx"),
      `#!/usr/bin/env bash\nprintf 'npx %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );

    await writeFile(
      path.join(binDir, "id"),
      '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 1; fi\n',
    );
    await writeFile(
      path.join(binDir, "useradd"),
      `#!/usr/bin/env bash\nprintf 'useradd %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "apt-get"),
      `#!/usr/bin/env bash\nprintf 'apt-get %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(path.join(binDir, "curl"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(
      path.join(binDir, "gpg"),
      "#!/usr/bin/env bash\ncat >/dev/null\n",
    );
    await writeFile(
      path.join(binDir, "chown"),
      `#!/usr/bin/env bash\nprintf 'chown %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "systemctl"),
      `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> ${JSON.stringify(logFile)}\n`,
    );
    await writeFile(
      path.join(binDir, "sed"),
      '#!/usr/bin/env bash\n/bin/sed "$@"',
    );
    await writeFile(
      path.join(binDir, "install"),
      '#!/usr/bin/env bash\n/bin/install "$@"',
    );
    await writeFile(
      path.join(binDir, "caddy"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await writeFile(
      path.join(binDir, "rsync"),
      `#!/usr/bin/env bash\nsrc=""\ndest=""\nfor arg in "$@"; do\n  case "$arg" in\n    --*) ;;\n    *) src="$dest"; dest="$arg" ;;\n  esac\ndone\nmkdir -p "$dest"\n(cd "$src" && tar --exclude=.git --exclude=node_modules --exclude=.next --exclude=backups --exclude=storage --exclude=tmp --exclude=uploads --exclude=downloads --exclude=logs --exclude=.env.local -cf - .) | (cd "$dest" && tar -xf -)\n`,
    );
    await writeFile(path.join(binDir, "git"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(
      path.join(binDir, "sleep"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    for (const command of ["node", "npm", "npx"])
      await chmod(path.join(customNodeDir, command), 0o755);
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "systemctl",
      "sed",
      "install",
      "caddy",
      "rsync",
      "git",
      "sleep",
    ]) {
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
          RUNTIME_ENV_FILE: path.join(appDir, ".env.runtime"),
          SOURCE_DIR: repoRoot,
          APP_NAME: "custom-console",
          APP_USER: "portable-app",
          DOMAIN: "portable.example.test",
          SERVICE_PREFIX: "customsvc",
          SITE_NAME: "自定义控制台",
          DESTDIR: fakeRoot,
          SKIP_PACKAGES: "1",
          SKIP_RESTART: "1",
          INSTALL_SYSTEMD_UNITS: "1",
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
        },
      });

      expect(result.code).toBe(0);
      const nextUnitPath = path.join(
        fakeRoot,
        "etc/systemd/system/customsvc-next.service",
      );
      const wsUnitPath = path.join(
        fakeRoot,
        "etc/systemd/system/customsvc-ssh-ws.service",
      );
      const nextUnit = await readFile(nextUnitPath, "utf8");
      const wsUnit = await readFile(wsUnitPath, "utf8");
      expect(nextUnit).toContain(`Environment=PATH=${customNodeDir}`);
      expect(nextUnit).toContain(
        `ExecStart=${path.join(customNodeDir, "node")} ${appDir}/dist/server.js`,
      );
      expect(nextUnit).toContain(
        "Description=自定义控制台 Next.js application",
      );
      expect(wsUnit).toContain(`Environment=PATH=${customNodeDir}`);
      expect(wsUnit).toContain(
        `ExecStart=${path.join(customNodeDir, "node")} ${appDir}/dist/ssh-ws-proxy.js`,
      );
      expect(nextUnit).toContain(
        `EnvironmentFile=${path.join(appDir, ".env.runtime")}`,
      );
      expect(wsUnit).toContain(
        `EnvironmentFile=${path.join(appDir, ".env.runtime")}`,
      );
      expect(wsUnit).toContain("Environment=SSH_WS_PORT=3001");
      const runtimeEnv = await readFile(
        path.join(appDir, ".env.runtime"),
        "utf8",
      );
      expect(runtimeEnv).not.toMatch(/^(PORT|NEXT_PORT|SSH_WS_PORT)=/m);
      expect(runtimeEnv).toContain("DATABASE_URL=");
      expect(result.stdout + result.stderr).not.toContain(
        "portable_initial_value",
      );
      expect(result.stdout + result.stderr).not.toContain(
        "whrkhldsb-next.service",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("refuses to install live systemd units from temporary APP_DIR test fixtures", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const binDir = path.join(appDir, "bin");
    await writeValidEnv(envFile);
    await mkdir(binDir, { recursive: true });
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "install",
      "caddy",
      "rsync",
      "git",
      "sleep",
      "node",
      "npm",
      "npx",
      "systemd-analyze",
      "systemctl",
    ]) {
      let body = "#!/usr/bin/env bash\nexit 0\n";
      if (command === "id")
        body =
          '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n';
      if (command === "node")
        body =
          "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n";
      await writeFile(path.join(binDir, command), body);
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:/usr/bin:/bin`,
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SOURCE_DIR: repoRoot,
          SKIP_PACKAGES: "1",
          SKIP_RESTART: "1",
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
        },
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        "Refusing to install live systemd units from temporary APP_DIR",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("refuses SKIP_SYSTEMD outside isolated DESTDIR test runs", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const binDir = path.join(appDir, "bin");
    await writeValidEnv(envFile);
    await mkdir(binDir, { recursive: true });
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "install",
      "caddy",
      "rsync",
      "git",
      "sleep",
      "node",
      "npm",
      "npx",
      "systemd-analyze",
      "systemctl",
    ]) {
      let body = "#!/usr/bin/env bash\nexit 0\n";
      if (command === "id")
        body =
          '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n';
      if (command === "node")
        body =
          "#!/usr/bin/env bash\nif [ \"$1\" = \"-p\" ]; then printf '22\\n'; else printf 'node\\n'; fi\n";
      await writeFile(path.join(binDir, command), body);
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:/usr/bin:/bin`,
          APP_DIR: appDir,
          ENV_FILE: envFile,
          SOURCE_DIR: repoRoot,
          SKIP_PACKAGES: "1",
          SKIP_RESTART: "1",
          SKIP_SYSTEMD: "1",
          SKIP_BUILD: "1",
          SKIP_DB_SETUP: "1",
          SKIP_CADDY: "1",
        },
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain(
        "SKIP_SYSTEMD=1 is only allowed together with DESTDIR",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("refuses DESTDIR unless restarts and explicit unit rendering are enabled so tests cannot overwrite live units", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    const fakeRoot = path.join(appDir, "fakeroot");
    const binDir = await mkdtemp(path.join(tmpdir(), "whrkhldsb-bin-"));

    await Promise.all([
      mkdir(path.join(appDir, "deploy/systemd"), { recursive: true }),
      mkdir(path.join(appDir, "node_modules"), { recursive: true }),
      mkdir(path.join(fakeRoot, "etc/systemd/system"), { recursive: true }),
    ]);
    await writeFile(
      envFile,
      "PG_DB_PASSWORD=12345678901234567890123456789012\nDATABASE_URL=postgresql://u:pass@localhost:5432/db\nAUTH_SESSION_SECRET=12345678901234567890123456789012\nSSH_WS_SECRET=12345678901234567890123456789012\nSSH_WS_ALLOWED_ORIGINS=http://localhost\nENCRYPTION_KEY=12345678901234567890123456789012\nADMIN_INITIAL_PASSWORD=12345678901234567890123456789012\n",
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-next.service.example"),
      "[Unit]\nDescription=test next\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/systemd/whrkhldsb-ssh-ws.service.example"),
      "[Unit]\nDescription=test ws\n[Service]\nWorkingDirectory={{APP_DIR}}\nEnvironmentFile={{ENV_FILE}}\nUser={{APP_USER}}\nGroup={{APP_USER}}\nExecStart=/bin/true\n",
    );
    await writeFile(
      path.join(appDir, "deploy/apache-next-proxy.example.conf"),
      "[VirtualHost *:80]\nServerName {{SERVER_NAME}}\nProxyPass / http://{{NEXT_HOST}}:{{NEXT_PORT}}/\nProxyPassReverse / http://{{NEXT_HOST}}:{{NEXT_PORT}}/\n",
    );
    for (const command of [
      "id",
      "useradd",
      "apt-get",
      "curl",
      "gpg",
      "chown",
      "install",
      "rsync",
      "git",
      "sleep",
      "systemd-analyze",
      "systemctl",
      "node",
      "npm",
      "npx",
    ]) {
      let body = "#!/usr/bin/env bash\nexit 0\n";
      if (command === "id")
        body =
          '#!/usr/bin/env bash\nif [ "$1" = "-u" ]; then printf \'0\\n\'; else exit 0; fi\n';
      await writeFile(path.join(binDir, command), body);
      await chmod(path.join(binDir, command), 0o755);
    }

    try {
      const withoutSkipRestart = await runScript(
        path.join(repoRoot, "deploy/install.sh"),
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: `${binDir}:/usr/bin:/bin`,
            APP_DIR: appDir,
            ENV_FILE: envFile,
            SOURCE_DIR: repoRoot,
            DESTDIR: fakeRoot,
            SKIP_PACKAGES: "1",
            SKIP_BUILD: "1",
            SKIP_DB_SETUP: "1",
            SKIP_CADDY: "1",
          },
        },
      );

      expect(withoutSkipRestart.code).not.toBe(0);
      expect(withoutSkipRestart.stderr + withoutSkipRestart.stdout).toContain(
        "DESTDIR",
      );
      expect(withoutSkipRestart.stderr + withoutSkipRestart.stdout).toContain(
        "SKIP_RESTART=1",
      );

      const withoutExplicitUnitRender = await runScript(
        path.join(repoRoot, "deploy/install.sh"),
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: `${binDir}:/usr/bin:/bin`,
            APP_DIR: appDir,
            ENV_FILE: envFile,
            SOURCE_DIR: repoRoot,
            DESTDIR: fakeRoot,
            SKIP_PACKAGES: "1",
            SKIP_RESTART: "1",
            SKIP_BUILD: "1",
            SKIP_DB_SETUP: "1",
            SKIP_CADDY: "1",
          },
        },
      );

      expect(withoutExplicitUnitRender.code).not.toBe(0);
      expect(
        withoutExplicitUnitRender.stderr + withoutExplicitUnitRender.stdout,
      ).toContain("INSTALL_SYSTEMD_UNITS=1");
    } finally {
      await rm(appDir, { force: true, recursive: true });
      await rm(binDir, { force: true, recursive: true });
    }
  });

  it("restarts Caddy when the service is inactive before restarting app services", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../install.sh"),
      "utf8",
    );
    expect(script).toContain("systemctl is-active --quiet caddy");
    expect(script).toContain("systemctl restart caddy");
  });

  it("uses explicit zero-status returns for skipped Apache setup under set -e", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../install.sh"),
      "utf8",
    );
    expect(script).toContain(
      'if [ "${SKIP_CADDY}" != "1" ]; then\n  return 0\n fi',
    );
  });

  it("uses a real URL-encoded PostgreSQL password in DATABASE_URL instead of a redacted placeholder", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../install.sh"),
      "utf8",
    );
    expect(script).toContain('encoded_pw="$(urlencode "${PG_DB_PASSWORD}")"');
    expect(script).toContain(
      'generated_url="postgresql://${PG_DB_USER}:${encoded_pw}@127.0.0.1:5432/${PG_DB_NAME}"',
    );
    expect(script).not.toContain(
      'generated_url="postgresql://${PG_DB_USER}:***@127.0.0.1:5432/${PG_DB_NAME}"',
    );
  });

  it("uses configured service ports in post-deploy smoke tests", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../smoke-test.sh"),
      "utf8",
    );
    expect(script).toContain(
      'ENV_FILE="${ENV_FILE:-${SMOKE_APP_DIR}/.env.local}"',
    );
    expect(script).toContain('source "${ENV_FILE}"');
    expect(script).toContain('NEXT_PORT="${NEXT_PORT:-3000}"');
    expect(script).toContain('SSH_WS_PORT="${SSH_WS_PORT:-3001}"');
    expect(script).toContain("127.0.0.1:${NEXT_PORT}");
    expect(script).toContain("127.0.0.1:${SSH_WS_PORT}");
    expect(script).toContain("http://localhost:${NEXT_PORT}/login");
    expect(script).not.toContain("127.0.0.1:3000");
    expect(script).not.toContain("127.0.0.1:3001");
    expect(script).not.toContain("localhost:3000/login");
  });

  it("labels reverse proxy smoke checks according to the active proxy service", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../smoke-test.sh"),
      "utf8",
    );
    expect(script).toContain('PROXY_SERVICE="caddy"');
    expect(script).toContain('PROXY_LABEL="Caddy"');
    expect(script).toContain('PROXY_PUBLIC_URL="https://${TARGET}"');
    expect(script).toContain('PROXY_PUBLIC_URL="http://${TARGET}"');
    expect(script).toContain('check "${PROXY_LABEL} on *:80"');
    expect(script).toContain('check "Login page (via ${PROXY_LABEL})"');
    expect(script).toContain("grep -i X-Content-Type-Options");
    expect(script).not.toContain("Apache on *:80");
    expect(script).not.toContain("Login page (via Apache)");
  });

  it("keeps fresh-install migrations aligned with mapped Prisma tables used by runtime pages", async () => {
    const migration = await readFile(
      path.resolve(
        __dirname,
        "../../prisma/migrations/20260526143000_align_fresh_install_schema/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      'ALTER TABLE IF EXISTS "Server" RENAME TO "servers"',
    );
    expect(migration).toContain(
      'ALTER TABLE IF EXISTS "DownloadTask" RENAME TO "download_tasks"',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "quick_services"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "image_uploads"');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "ai_hosted_actions"',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "server_file_proxies"',
    );
    expect(migration).toContain(
      '"hostingEnabled" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).toContain('"toolCalls" TEXT NOT NULL DEFAULT');
    expect(migration).toContain(
      'ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "displayName" TO "display_name"',
    );
    expect(migration).toContain(
      'ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "sourceId" TO "source_id"',
    );
  });

  it("can print saved first-install credentials without running the installer", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const appDir = await makeAppDir();
    const envFile = path.join(appDir, ".env.local");
    await writeFile(
      envFile,
      [
        'ADMIN_INITIAL_PASSWORD="admin-first-pass"',
        'PG_DB_PASSWORD="pg-first-pass"',
        'DATABASE_URL="postgresql://whrkhldsb:pg-first-pass@127.0.0.1:5432/whrkhldsb"',
      ].join("\n"),
    );

    try {
      const result = await runScript(path.join(repoRoot, "deploy/install.sh"), {
        cwd: repoRoot,
        env: {
          ...process.env,
          APP_DIR: appDir,
          ENV_FILE: envFile,
        },
        args: ["--show-credentials"],
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("Admin username: admin");
      expect(result.stdout).toContain(
        "Admin initial password: admin-first-pass",
      );
      expect(result.stdout).toContain("PostgreSQL password: pg-first-pass");
      expect(result.stdout).toContain(
        "DATABASE_URL: postgresql://whrkhldsb:pg-first-pass@127.0.0.1:5432/whrkhldsb",
      );
      expect(result.stdout + result.stderr).not.toContain(
        "Installing dependencies",
      );
    } finally {
      await rm(appDir, { force: true, recursive: true });
    }
  });

  it("removes deprecated browser-exposed SSH WebSocket secrets from generated env files", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../install.sh"),
      "utf8",
    );
    expect(script).toContain("remove_env_var NEXT_PUBLIC_SSH_WS_SECRET");
    expect(script).toContain("browser-exposed SSH secrets are not allowed");
    expect(script).not.toContain(
      "Synced NEXT_PUBLIC_SSH_WS_SECRET with SSH_WS_SECRET",
    );
  });

  it("defaults to root for in-place deployments under /root unless APP_USER is explicit", async () => {
    const script = await readFile(
      path.resolve(__dirname, "../install.sh"),
      "utf8",
    );
    expect(script).toContain("APP_USER_EXPLICIT");
    expect(script).toContain("/root|/root/*");
    expect(script).toContain('APP_USER="root"');
  });
});

describe("compressed archive deployment entrypoints", () => {
  it("includes a root one-click installer, bootstrap installer, and archive packaging script", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const rootInstaller = path.join(repoRoot, "install.sh");
    const bootstrapInstaller = path.join(repoRoot, "deploy/bootstrap.sh");
    const archiveScript = path.join(repoRoot, "deploy/package.sh");

    await expect(access(rootInstaller)).resolves.toBeUndefined();
    await expect(access(bootstrapInstaller)).resolves.toBeUndefined();
    await expect(access(archiveScript)).resolves.toBeUndefined();

    for (const script of [rootInstaller, bootstrapInstaller, archiveScript]) {
      const result = await runScript(script, {
        cwd: repoRoot,
        env: { ...process.env, CHECK_SYNTAX_ONLY: "1" },
      });
      expect(result.code, result.stdout + result.stderr).toBe(0);
    }

    const installer = await readFile(rootInstaller, "utf8");
    const bootstrap = await readFile(bootstrapInstaller, "utf8");
    const packager = await readFile(archiveScript, "utf8");
    expect(installer).toContain("SOURCE_DIR");
    expect(installer).toContain("deploy/install.sh");
    expect(bootstrap).toContain(
      'REPO_URL="${REPO_URL:-https://github.com/whrkhldsb-star/VControlHub.git}"',
    );
    expect(bootstrap).toContain("prompt_with_default");
    expect(bootstrap).toContain("VCONTROLHUB_ASSUME_DEFAULTS");
    expect(bootstrap).toContain("Domain / public hostname");
    expect(bootstrap).toContain("Next.js service port");
    expect(bootstrap).toContain("SSH WebSocket service port");
    expect(bootstrap).toContain("Install directory");
    expect(bootstrap).toContain("git clone");
    expect(bootstrap).toContain("deploy/install.sh");
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
      expect(result.stdout.trim()).toBe(
        path.join(outputDir, "my-console-release-portabletest.tar.gz"),
      );

      const listing = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        const child = spawn("tar", [
          "-tzf",
          path.join(outputDir, "my-console-release-portabletest.tar.gz"),
        ]);
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
      expect(listing.code, listing.stderr).toBe(0);
      expect(listing.stdout).toContain("my-console-bundle/./install.sh");
      expect(listing.stdout).not.toContain("whrkhldsb-release/");
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });
});
