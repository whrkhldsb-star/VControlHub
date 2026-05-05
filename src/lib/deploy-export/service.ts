import { prisma } from "@/lib/db";

const DANGEROUS_ENV_FLAGS = [
  "ENABLE_DEMO_FALLBACK",
  "AUTH_DEMO_FALLBACK",
  "SERVER_DEMO_FALLBACK",
  "STORAGE_DEMO_FALLBACK",
  "COMMAND_DEMO_FALLBACK",
  "SEED_DEMO_DATA",
];

function sanitizeAppName(value?: string) {
  const appName = (value ?? "whrkhldsb").trim();
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(appName)) {
    throw new Error("应用名称只能包含小写字母、数字和连字符，且必须以字母开头");
  }
  return appName;
}

function sanitizeDomain(value?: string) {
  const domain = (value ?? "example.com").trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("域名格式不合法");
  }
  return domain;
}

export function buildPortableDeploymentPackage(options: { domain?: string; appName?: string } = {}) {
  const appName = sanitizeAppName(options.appName);
  const domain = sanitizeDomain(options.domain);
  const envTemplate = [
    'DATABASE_URL="REPLACE_WITH_DATABASE_URL"',
    'AUTH_SESSION_SECRET="REPLACE_WITH_AUTH_SESSION_SECRET"',
    'NEXT_PUBLIC_APP_URL="https://' + domain + '"',
    ...DANGEROUS_ENV_FLAGS.map((key) => `${key}="false"`),
  ].join("\n");
  const systemdUnit = `[Unit]\nDescription=${appName} Next.js app\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=/opt/${appName}\nEnvironmentFile=/opt/${appName}/.env.production\nExecStart=/usr/bin/npm run start\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n`;
  const caddyfile = `${domain} {\n  reverse_proxy 127.0.0.1:3000\n}\n`;
  const deployScript = `#!/usr/bin/env bash\nset -euo pipefail\nAPP_DIR=\"\${APP_DIR:-/opt/${appName}}\"\nmkdir -p \"$APP_DIR\"/{storage,uploads,downloads,logs,backups,tmp}\nnpm ci\nnpx prisma generate\nnpx prisma migrate deploy\nnpm run build\n`;
  const files = { "env.production.example": envTemplate, [`${appName}-next.service`]: systemdUnit, "Caddyfile.example": caddyfile, "deploy.sh": deployScript };
  const joined = Object.values(files).join("\n");
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(joined) || /BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY/.test(joined)) {
    throw new Error("部署包模板包含敏感内容，已拒绝导出");
  }
  return { manifest: { appName, domain, generatedAt: new Date().toISOString(), dangerousEnvFlags: DANGEROUS_ENV_FLAGS }, files };
}

export async function createDeploymentExport(input: { userId?: string; domain?: string; appName?: string }) {
  const pkg = buildPortableDeploymentPackage({ domain: input.domain, appName: input.appName });
  return prisma.deploymentExport.create({ data: { name: `${pkg.manifest.appName}-portable`, manifest: pkg.manifest, files: pkg.files, createdBy: input.userId ?? null } });
}
