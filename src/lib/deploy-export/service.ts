import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { BusinessError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

const DANGEROUS_ENV_FLAGS = [
	"ENABLE_DEMO_FALLBACK",
	"AUTH_DEMO_FALLBACK",
	"SERVER_DEMO_FALLBACK",
	"STORAGE_DEMO_FALLBACK",
	"COMMAND_DEMO_FALLBACK",
	"SEED_DEMO_DATA",
];

import { getAppSlug } from "@/lib/branding";

const APP_IDENTIFIER = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * The identifier used for service names, paths and cookies. Without an
 * explicit one it comes from this instance's slug: the display name
 * ("VControlHub") never passed the identifier rule, so the export failed
 * unless a name was typed in.
 */
function defaultAppIdentifier() {
	const slug = getAppSlug().toLowerCase();
	return APP_IDENTIFIER.test(slug) ? slug : "vcontrolhub";
}

function sanitizeAppName(value?: string) {
	const appName = (value?.trim() || defaultAppIdentifier());
	if (!APP_IDENTIFIER.test(appName)) {
		throw new ValidationError(t("backend.deployExport.appNameInvalid"));
	}
	return appName;
}

function sanitizeDomain(value?: string) {
	const domain = (value ?? "example.com").trim().toLowerCase();
	if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
		throw new ValidationError(t("backend.deployExport.domainInvalid"));
	}
	return domain;
}

export function buildPortableDeploymentPackage(options: { domain?: string; appName?: string } = {}) {
	const domain = sanitizeDomain(options.domain);
	const appName = sanitizeAppName(options.appName);
	const envTemplate = [
		`APP_BASE_URL="https://${domain}"`,
		`APP_NAME="${appName}"`,
		`APP_SLUG="${appName}"`,
		`SITE_NAME="${appName}"`,
		`AUTH_SESSION_COOKIE_NAME="${appName}_session"`,
		`AUTH_SESSION_ISSUER="${appName}"`,
		`AUTH_SESSION_AUDIENCE="${appName}"`,
		'DATABASE_URL=""',
		'AUTH_SESSION_SECRET=""',
		'ENCRYPTION_KEY=""',
		'ADMIN_INITIAL_PASSWORD=""',
		'STORAGE_DIRECT_ACCESS_SECRET=""',
		`NEXT_PUBLIC_APP_PUBLIC_LABEL="VPS Management & Distributed Cloud Drive"`,
		'SSH_WS_HOST="127.0.0.1"',
		// Literal values: systemd's EnvironmentFile (and dotenv) do not expand
		// shell defaults, so "${PORT:-3000}" reached the server as text and it
		// exited on an invalid port.
		'SSH_WS_PORT="3001"',
		'SSH_WS_SECRET=""',
		'PORT="3000"',
		`SSH_WS_ALLOWED_ORIGINS="https://${domain}"`,
		...DANGEROUS_ENV_FLAGS.map((key) => `${key}="false"`),
	].join("\n");
	const appDir = "/opt/" + appName;
	const unitParams: Record<string, string> = {
		SITE_NAME: appName, APP_DIR: appDir, APP_SLUG: appName, SERVICE_PREFIX: appName, APP_USER: "vcontrolhub",
		RUNTIME_ENV_FILE: appDir + "/.env.production", SYSTEMD_PATH: "/usr/local/bin:/usr/bin:/bin",
		NODE_BIN: "/usr/bin/node", NEXT_PORT: "3000", SSH_WS_PORT: "3001", QUICK_SERVICE_READ_WRITE_PATHS: "",
	};
	// These assets belong to the server compilation. The runner ships its
	// .next/server/chunks tree even when it omits the source deploy directory.
	const renderUnit = (asset: URL, service: string) => {
		const original = path.join(process.cwd(), "deploy/systemd", "vcontrolhub-" + service + ".service.example");
		const file = existsSync(original) ? original : path.join(process.cwd(), ".next/server/chunks/static/media", path.basename(asset.pathname));
		return readFileSync(file, "utf8").replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
			if (!Object.hasOwn(unitParams, key)) throw new Error("Unknown systemd template parameter " + key);
			return unitParams[key]!;
		});
	};
	const systemdUnit = renderUnit(new URL("../../../deploy/systemd/vcontrolhub-next.service.example", import.meta.url), "next");
	const workerUnit = renderUnit(new URL("../../../deploy/systemd/vcontrolhub-worker.service.example", import.meta.url), "worker");
	const sshWsUnit = renderUnit(new URL("../../../deploy/systemd/vcontrolhub-ssh-ws.service.example", import.meta.url), "ssh-ws");
	// Ports are literal, as in the env template: {env.PORT} is Caddy's own
	// environment, which never holds the app's, so every request went to
	// "127.0.0.1:" (502). Remote desktop shares the WebSocket gateway.
	const caddyfile = [
		"{",
		"\t# A reload waits for open connections at most this long, then closes them.",
		"\tgrace_period 10s",
		"}",
		"",
		`${domain} {`,
		"\tencode gzip zstd",
		"\treverse_proxy /ssh 127.0.0.1:3001",
		"\treverse_proxy /ssh/* 127.0.0.1:3001",
		"\treverse_proxy /rdp 127.0.0.1:3001",
		"\treverse_proxy 127.0.0.1:3000",
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
		'ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"',
		'DEPLOY_LOCK="${DEPLOY_LOCK:-/run/lock/vcontrolhub-deploy.lock}"',
		'exec 9>>"$DEPLOY_LOCK"',
		'flock -n 9 || { echo "Another deployment holds $DEPLOY_LOCK" >&2; exit 75; }',
		'mkdir -p "$APP_DIR"/{storage,uploads,downloads,logs,backups,tmp}',
		// The units run the build in $APP_DIR; building wherever the script
		// was started left them without dist/.
		'cd "$APP_DIR"',
		// Prisma takes DATABASE_URL from the environment: its config reads .env,
		// .env.local and .env.runtime, not the file the units use, so "prisma
		// generate" stopped on "Cannot resolve environment variable". The file is
		// read as systemd's EnvironmentFile reads it (no shell expansion: a "$" in
		// a password stays one).
		'if [ ! -f "$ENV_FILE" ]; then',
		'\techo "Missing $ENV_FILE: copy env.production.example there and fill it in first." >&2',
		"\texit 1",
		"fi",
		'while IFS= read -r line || [ -n "$line" ]; do',
		"\tline=\"${line%$'\\r'}\"",
		'\tcase "$line" in "" | "#"*) continue ;; *=*) ;; *) continue ;; esac',
		'\tvalue="${line#*=}"',
		'\tcase "$value" in',
		'\t\t\\"*\\") value="${value#\\"}"; value="${value%\\"}" ;;',
		"\t\t\\'*\\') value=\"${value#\\'}\"; value=\"${value%\\'}\" ;;",
		"\tesac",
		'\texport "${line%%=*}=$value"',
		'done < "$ENV_FILE"',
		'for key in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD SSH_WS_SECRET STORAGE_DIRECT_ACCESS_SECRET ENCRYPTION_KEY; do',
		'  case "${!key:-}" in ""|*REPLACE_WITH*|*CHANGE_ME*|*CHANGE_THIS*|*your-domain.example*|*example.com*|*"***"*) echo "Configure $key in $ENV_FILE" >&2; exit 1 ;; esac',
		'done',
		'[ "${#AUTH_SESSION_SECRET}" -ge 32 ] || { echo "AUTH_SESSION_SECRET is too short" >&2; exit 1; }',
		...DANGEROUS_ENV_FLAGS.map(key => `[ "${"${"}${key}:-false}" != true ] || { echo "${key} is unsafe for production" >&2; exit 1; }`),
		// "npm run build" refuses to run unless it is told this is a deployment
		// (scripts/guard-live-next-build.mjs), and then only while the service
		// is stopped: a build under a running server replaces the .next it serves.
		'export NEXT_SYSTEMD_SERVICE="$SERVICE_PREFIX-next.service"',
		"export VCONTROLHUB_DEPLOY_BUILD=1",
		`[ "${"${"}NEXT_PUBLIC_APP_URL:-$APP_BASE_URL}" = "https://${domain}" ] && [ "$APP_BASE_URL" = "https://${domain}" ] || { echo "Public URL must match Caddy" >&2; exit 1; }`,
		'for unit in "$SERVICE_PREFIX"-{next,worker,ssh-ws}.service; do',
		'  state=$(systemctl show "$unit" -p ActiveState --value) || exit 1',
		'  case "$state" in inactive|failed) ;; *) echo "Stop $unit before deploying" >&2; exit 1 ;; esac',
		'done',
		"npm ci",
		"npx prisma generate",
		"npx prisma migrate deploy",
		"npm run build",
		// The units start dist/server.js, dist/worker.js and dist/ssh-ws-proxy.js,
		// which only the runtime build produces (dist is not in Git).
		"npm run build:runtime",
		"NODE_ENV=production node dist/seed.js",
		"",
	].join("\n");
	const files = {
		"env.production.example": envTemplate,
		[`${appName}-next.service`]: systemdUnit,
		[`${appName}-worker.service`]: workerUnit,
		[`${appName}-ssh-ws.service`]: sshWsUnit,
		"Caddyfile.example": caddyfile,
		"install-services.sh": [
			"#!/usr/bin/env bash", "set -euo pipefail", 'cd "$(dirname "$0")"',
			"systemd-sysusers - <<'ACCOUNT'", 'u vcontrolhub - "VControlHub service" /nonexistent', "ACCOUNT",
			`install -d -m 0750 -o vcontrolhub -g vcontrolhub /var/lib/${appName}`,
			`for dir in storage uploads downloads logs backups .next/cache; do install -d -m 0750 -o vcontrolhub -g vcontrolhub "${appDir}/$dir"; done`,
			`chmod 0600 "${appDir}/.env.production"`,
			`for unit in ${appName}-{next,worker,ssh-ws}.service; do install -m 0644 "$unit" /etc/systemd/system/; done`,
			"systemctl daemon-reload", "",
		].join("\n"),
		"deploy.sh": deployScript,
	};
	const joined = Object.values(files).join("\n");
	if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(joined) || /BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY/.test(joined)) {
		throw new BusinessError(t("backend.deployExport.templateContainsSecrets"));
	}
	return { manifest: { appName, domain, generatedAt: new Date().toISOString(), dangerousEnvFlags: DANGEROUS_ENV_FLAGS }, files };
}

export async function createDeploymentExport(input: { userId?: string; domain?: string; appName?: string }) {
	const pkg = buildPortableDeploymentPackage({ domain: input.domain, appName: input.appName });
	return prisma.deploymentExport.create({ data: { name: `${pkg.manifest.appName}-portable`, manifest: pkg.manifest, files: pkg.files, createdBy: input.userId ?? null } });
}
