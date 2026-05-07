import { prisma } from "@/lib/db";

const DANGEROUS_ENV_FLAGS = [
	"ENABLE_DEMO_FALLBACK",
	"AUTH_DEMO_FALLBACK",
	"SERVER_DEMO_FALLBACK",
	"STORAGE_DEMO_FALLBACK",
	"COMMAND_DEMO_FALLBACK",
	"SEED_DEMO_DATA",
];

import { getAppName } from "@/lib/branding";

function sanitizeAppName(value?: string) {
	const appName = (value ?? getAppName()).trim();
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
		`APP_NAME="${appName}"`,
		`APP_SLUG="${appName}"`,
		`SITE_NAME="${appName}"`,
		`AUTH_SESSION_COOKIE_NAME="${appName}_session"`,
		`AUTH_SESSION_ISSUER="${appName}"`,
		`AUTH_SESSION_AUDIENCE="${appName}"`,
		'DATABASE_URL="REPLACE_WITH_DATABASE_URL"',
		'AUTH_SESSION_SECRET="REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARS"',
		'ADMIN_INITIAL_PASSWORD="REPLACE_WITH_A_SECURE_ADMIN_PASSWORD"',
		`NEXT_PUBLIC_APP_PUBLIC_LABEL="${domain}"`,
		'SSH_WS_HOST="127.0.0.1"',
		'SSH_WS_PORT="${SSH_WS_PORT:-3001}"',
		'PORT="${PORT:-3000}"',
		`SSH_WS_ALLOWED_ORIGINS="https://${domain}"`,
		...DANGEROUS_ENV_FLAGS.map((key) => `${key}="false"`),
	].join("\n");
	const systemdUnit = [
		"[Unit]",
		`Description=${appName} Next.js app`,
		"After=network-online.target postgresql.service",
		"Wants=network-online.target",
		"",
		"[Service]",
		"Type=simple",
		`WorkingDirectory=/opt/${appName}`,
		`EnvironmentFile=/opt/${appName}/.env.production`,
		"Environment=NODE_ENV=production",
		"ExecStart=/usr/bin/npm run start",
		"Restart=always",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n");
	const sshWsUnit = [
		"[Unit]",
		`Description=${appName} SSH WebSocket proxy`,
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		"Type=simple",
		`WorkingDirectory=/opt/${appName}`,
		`EnvironmentFile=/opt/${appName}/.env.production`,
		"Environment=NODE_ENV=production",
		"ExecStart=/usr/bin/npx tsx src/ssh-ws-proxy.ts",
		"Restart=always",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n");
	const caddyfile = [
		`${domain} {`,
		"  encode gzip zstd",
		" reverse_proxy /ssh 127.0.0.1:{env.SSH_WS_PORT}",
		" reverse_proxy /ssh/* 127.0.0.1:{env.SSH_WS_PORT}",
		" reverse_proxy 127.0.0.1:{env.PORT}",
		"}",
		"",
	].join("\n");
	const deployScript = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`APP_NAME="\${APP_NAME:-${appName}}"`,
		`APP_SLUG="\${APP_SLUG:-${appName}}"`,
		'SERVICE_PREFIX="${SERVICE_PREFIX:-$APP_SLUG}"',
		'APP_DIR="${APP_DIR:-/opt/$APP_SLUG}"',
		'mkdir -p "$APP_DIR"/{storage,uploads,downloads,logs,backups,tmp}',
		"npm ci",
		"npx prisma generate",
		"npx prisma migrate deploy",
		"npm run build",
		"",
	].join("\n");
	const files = {
		"env.production.example": envTemplate,
		[`${appName}-next.service`]: systemdUnit,
		[`${appName}-ssh-ws.service`]: sshWsUnit,
		"Caddyfile.example": caddyfile,
		"deploy.sh": deployScript,
	};
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
