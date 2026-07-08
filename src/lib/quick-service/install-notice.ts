import crypto from "node:crypto";

import { buildQuickServiceAccessUrl } from "./access-url";
import { config } from "@/lib/config/env";
import type { ServiceTemplate } from "./types";

export type QuickServiceCredential = {
	label: string;
	value: string;
};

export type QuickServiceInstallNotice = {
	accessUrl: string | null;
	credentials: QuickServiceCredential[];
	notes: string[];
};

type PreparedInstallSecrets = {
	template: ServiceTemplate;
	credentials: QuickServiceCredential[];
	notes: string[];
};

type AppCredentialRule = {
	usernameLabel?: string;
	username?: string;
	usernameEnv?: string;
	passwordLabel?: string;
	passwordEnv: string;
	forceRandomWhen?: (value: string | undefined) => boolean;
	notes?: string[];
};

const DEFAULT_CREDENTIAL_NOTES: Record<string, string[]> = {
	nextcloud: ["Nextcloud first launch enters the admin creation wizard; please set up the admin account, password and data directory in the page."],
	filebrowser: ["File Browser image typically uses default credentials admin / admin; if login fails, confirm the initialization config in the container logs or /opt/filebrowser/config, and change the password immediately after first login."],
	davos: ["Davos first launch usually requires following the page wizard to configure an account or connector; the image does not provide a fixed initial password."],
	emby: ["Emby first launch enters the media server wizard; please create an admin account in the page."],
	jellyfin: ["Jellyfin first launch enters the setup wizard; please create an admin account in the page."],
	navidrome: ["Navidrome first launch requires creating the first admin user; please complete initialization in the page."],
	immich: ["Immich first launch requires registering the first admin account; the current quick service only starts the app container, external database/Redis still needs to be prepared per the app requirements."],
	metube: ["MeTube has no login password by default; please use it only on trusted networks, and add access control at the reverse proxy layer if needed."],
	komga: ["Komga first launch enters the admin creation flow; please set up the account and password in the page."],
	gitea: ["Gitea first launch enters the installation wizard; please confirm the database/site URL then create an admin account."],
	vaultwarden: ["Vaultwarden has open registration by default; please create an account after first login, and set up an admin token/disable public registration as needed."],
	portainer: ["Portainer first launch requires creating an admin password; please complete initialization in the page."],
	"stirling-pdf": ["Stirling PDF current template disables built-in security login; no account or password needed by default."],
	"it-tools": ["IT-Tools requires no login by default."],
	gladys: ["Gladys first launch enters the account creation wizard; please set up the admin account in the page."],
	memos: ["The first user to register on Memos usually becomes the admin; please create the initial account in the page."],
	outline: ["Outline requires an external database/Redis/authentication config to fully initialize; please continue configuration per the app page and logs."],
	hedgedoc: ["HedgeDoc first use is usually via page registration/login; please add database and authentication config before production use."],
	affine: ["AFFiNE first launch enters the workspace/account initialization flow; please follow the page prompts to complete it."],
	linkwarden: ["Linkwarden requires dependencies such as a database; if the first launch prompts about missing config, complete the environment variables per the app logs."],
	wallabag: ["Wallabag official image commonly uses default credentials wallabag / wallabag; if login fails, check the container logs to confirm initialization status, and change the password after first login."],
	"uptime-kuma": ["Uptime Kuma first launch requires creating an admin account."],
	adguardhome: ["AdGuard Home first launch enters the installation wizard; please set up the admin account, password and DNS listening port in the page."],
	"speedtest-tracker": ["SpeedTest Tracker first login/initialization method varies by image version; please complete configuration per the page prompts or container logs."],
	beszel: ["Beszel first launch requires creating an admin account."],
	changedetection: ["changedetection.io does not enforce login by default; if you need to protect access, configure authentication at the app or reverse proxy layer."],
	ghost: ["After Ghost first launch, please visit /ghost/ to complete admin account creation."],
	wordpress: ["WordPress requires an available database before entering the installation wizard; the current template does not generate a WordPress admin password."],
	typecho: ["Typecho first launch enters the installation wizard; please create an admin account in the page."],
	"itdog-tcping": ["ITDog TCPing requires no login by default."],
	qrcode: ["QR Code service requires no login by default."],
	dufs: ["Dufs current template requires no login by default; please use it only on trusted networks or add access control yourself."],
	pairdrop: ["PairDrop requires no login by default."],
	tianji: ["Tianji first launch enters the account/site initialization flow; please follow the page prompts to complete it."],
	"lobe-chat": ["LobeChat requires no local account by default; please configure the model Provider/API Key in the app before use."],
	frps: ["FRPS mainly works via config file; please maintain frps.toml/frps.ini in /opt/frps/config then restart the service."],
	maxtext: ["MaxKB initial login info varies by image version; please confirm the default account per the page prompts or container logs, and change the password after first login."],
};

const APP_CREDENTIAL_RULES: Record<string, AppCredentialRule> = {
	minio: {
		usernameEnv: "MINIO_ROOT_USER",
		username: "minioadmin",
		passwordEnv: "MINIO_ROOT_PASSWORD",
		forceRandomWhen: (value) => !value || value === "minioadmin",
		notes: ["MinIO Root password has been auto-generated at install time; please rotate the Root user or create a dedicated Access Key after first login as needed."],
	},
	photoprism: {
		username: "admin",
		passwordEnv: "PHOTOPRISM_ADMIN_PASSWORD",
		forceRandomWhen: (value) => !value || value === "pleasechange",
		notes: ["PhotoPrism admin password has been auto-generated at install time."],
	},
	"code-server": {
		passwordEnv: "PASSWORD",
		forceRandomWhen: (value) => !value,
		notes: ["Code Server browser login password has been auto-generated at install time."],
	},
	n8n: {
		usernameEnv: "N8N_BASIC_AUTH_USER",
		username: "admin",
		passwordEnv: "N8N_BASIC_AUTH_PASSWORD",
		forceRandomWhen: (value) => !value || value === "admin",
		notes: ["n8n Basic Auth password has been auto-generated at install time."],
	},
	pihole: {
		username: "admin",
		passwordEnv: "WEBPASSWORD",
		forceRandomWhen: (value) => !value || value === "changeme",
		notes: ["Pi-hole Web admin password has been auto-generated at install time."],
	},
	halo: {
		usernameEnv: "HALO_SECURITY_INITIALIZER_SUPERADMINUSERNAME",
		username: "admin",
		passwordEnv: "HALO_SECURITY_INITIALIZER_SUPERADMINPASSWORD",
		forceRandomWhen: (value) => !value || value === "admin123",
		notes: ["Halo super admin initial password has been auto-generated at install time."],
	},
};

function generatePassword() {
	return crypto.randomBytes(12).toString("base64url");
}

function secretLabelFromEnvKey(key: string) {
	const normalized = key.replace(/_/g, " ").toLowerCase();
	if (normalized.includes("token")) return `${key} Token`;
	if (normalized.includes("secret")) return `${key} Secret`;
	if (normalized.includes("password")) return key === "PASSWORD" ? "Password" : `${key} Password`;
	return key;
}

function collectStaticEnvCredentials(envJson: Record<string, string>, alreadyReportedKeys: Set<string>) {
	const credentials: QuickServiceCredential[] = [];
	for (const [key, value] of Object.entries(envJson)) {
		if (alreadyReportedKeys.has(key)) continue;
		if (!value) continue;
		if (!/(PASSWORD|TOKEN|SECRET|KEY)$/i.test(key)) continue;
		if (/^(PUID|PGID|UMASK|DB_HOSTNAME|PGSSLMODE|DOCKER_ENABLE_SECURITY)$/i.test(key)) continue;
		credentials.push({ label: secretLabelFromEnvKey(key), value });
		alreadyReportedKeys.add(key);
	}
	return credentials;
}

function applyCredentialRule(template: ServiceTemplate, rule: AppCredentialRule) {
	const envJson = { ...template.envJson };
	const credentials: QuickServiceCredential[] = [];
	const reportedKeys = new Set<string>();
	if (rule.usernameEnv && !envJson[rule.usernameEnv]) envJson[rule.usernameEnv] = rule.username ?? "admin";
	const username = rule.usernameEnv ? envJson[rule.usernameEnv] : rule.username;
	if (username) credentials.push({ label: rule.usernameLabel ?? "Account", value: username });

	const currentPassword = envJson[rule.passwordEnv];
	const password = rule.forceRandomWhen?.(currentPassword) ? generatePassword() : currentPassword || generatePassword();
	envJson[rule.passwordEnv] = password;
	credentials.push({ label: rule.passwordLabel ?? "Initial password", value: password });
	reportedKeys.add(rule.passwordEnv);
	if (rule.usernameEnv) reportedKeys.add(rule.usernameEnv);

	return {
		template: { ...template, envJson },
		credentials: [...credentials, ...collectStaticEnvCredentials(envJson, reportedKeys)],
		notes: rule.notes ?? [],
	};
}

export function prepareInstallSecrets(template: ServiceTemplate): PreparedInstallSecrets {
	if (template.slug === "alist") {
		const password = generatePassword();
		return {
			template: { ...template, initialPassword: password },
			credentials: [
				{ label: "Account", value: "admin" },
				{ label: "Initial password", value: password },
			],
			notes: ["AList initial admin password has been auto-set after container startup."],
		};
	}

	const rule = APP_CREDENTIAL_RULES[template.slug];
	if (rule) return applyCredentialRule(template, rule);

	const reportedKeys = new Set<string>();
	const credentials = collectStaticEnvCredentials(template.envJson, reportedKeys);
	const notes = DEFAULT_CREDENTIAL_NOTES[template.slug] ?? ["This app does not declare fixed initial credentials; please complete initialization per the first-launch page or container logs."];
	return { template, credentials, notes };
}

export function buildInstallNotice(template: ServiceTemplate, hostPort: number, credentials: QuickServiceCredential[], notes: string[]): QuickServiceInstallNotice {
	const publicHost = config.app.publicQuickServiceHost;
	return {
		accessUrl: buildQuickServiceAccessUrl({
			port: hostPort,
			defaultPort: template.defaultPort,
			configuredHost: publicHost,
			protocol: publicHost ? "http:" : undefined,
		}),
		credentials,
		notes,
	};
}

export function formatInstallNoticeMessage(serviceName: string, notice: QuickServiceInstallNotice) {
	const lines = [`${serviceName} has been installed and started successfully.`];
	if (notice.accessUrl) lines.push(`Access URL: ${notice.accessUrl}`);
	if (notice.credentials.length > 0) {
		lines.push("Initial login information:");
		for (const credential of notice.credentials) lines.push(`${credential.label}: ${credential.value}`);
	} else {
		lines.push("Initial login information: no fixed account or password.");
	}
	for (const note of notice.notes) lines.push(note);
	return lines.join("\n");
}
