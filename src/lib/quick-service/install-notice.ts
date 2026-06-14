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
	nextcloud: ["Nextcloud 首次打开会进入管理员创建向导；请在页面中设置管理员账号、密码和数据目录。"],
	filebrowser: ["File Browser 镜像通常使用默认账号 admin / admin；如登录失败，请在容器日志或 /opt/filebrowser/config 中确认初始化配置，并首次登录后立即修改密码。"],
	davos: ["Davos 首次打开通常需要按页面向导配置账号或连接器；该镜像未提供固定初始化密码。"],
	emby: ["Emby 首次打开会进入媒体服务器向导；请在页面中创建管理员账号。"],
	jellyfin: ["Jellyfin 首次打开会进入设置向导；请在页面中创建管理员账号。"],
	navidrome: ["Navidrome 首次打开会要求创建第一个管理员用户；请在页面中完成初始化。"],
	immich: ["Immich 首次打开会要求注册第一个管理员账号；当前快捷服务只启动应用容器，外部数据库/Redis 仍需按应用要求准备。"],
	metube: ["MeTube 默认无登录密码；请只在可信网络中使用，必要时在反向代理层增加访问控制。"],
	komga: ["Komga 首次打开会进入管理员创建流程；请在页面中设置账号密码。"],
	gitea: ["Gitea 首次打开会进入安装向导；请确认数据库/站点 URL 后创建管理员账号。"],
	vaultwarden: ["Vaultwarden 默认开放注册；请首次登录后创建账号，并按需设置管理 Token/关闭公开注册。"],
	portainer: ["Portainer 首次打开会要求创建管理员密码；请在页面中完成初始化。"],
	"stirling-pdf": ["Stirling PDF 当前模板关闭内置安全登录；默认无需账号密码。"],
	"it-tools": ["IT-Tools 默认无需登录。"],
	gladys: ["Gladys 首次打开会进入账号创建向导；请在页面中设置管理员账号。"],
	memos: ["Memos 首次注册的用户通常会成为管理员；请在页面中创建初始账号。"],
	outline: ["Outline 需要外部数据库/Redis/鉴权配置后才能完整初始化；请按应用页面和日志继续配置。"],
	hedgedoc: ["HedgeDoc 首次使用通常通过页面注册/登录；生产使用前请补充数据库和认证配置。"],
	affine: ["AFFiNE 首次打开会进入工作区/账号初始化流程；请按页面提示完成。"],
	linkwarden: ["Linkwarden 需要数据库等依赖配置；首次打开如提示配置缺失，请按应用日志补齐环境变量。"],
	wallabag: ["Wallabag 官方镜像常见默认账号密码为 wallabag / wallabag；如登录失败，请查看容器日志确认初始化状态，并首次登录后修改密码。"],
	"uptime-kuma": ["Uptime Kuma 首次打开会要求创建管理员账号。"],
	adguardhome: ["AdGuard Home 首次打开会进入安装向导；请在页面中设置管理员账号密码和 DNS 监听端口。"],
	"speedtest-tracker": ["SpeedTest Tracker 首次登录/初始化方式随镜像版本变化；请按页面提示或容器日志完成配置。"],
	beszel: ["Beszel 首次打开会要求创建管理员账号。"],
	changedetection: ["changedetection.io 默认不强制登录；如需保护访问，请在应用或反向代理层配置认证。"],
	ghost: ["Ghost 首次打开后请访问 /ghost/ 完成管理员账号创建。"],
	wordpress: ["WordPress 需要可用数据库后进入安装向导；当前模板不会生成 WordPress 管理员密码。"],
	typecho: ["Typecho 首次打开会进入安装向导；请在页面中创建管理员账号。"],
	"itdog-tcping": ["ITDog TCPing 默认无需登录。"],
	qrcode: ["QR Code 服务默认无需登录。"],
	dufs: ["Dufs 当前模板默认无需登录；请只在可信网络中使用或自行增加访问控制。"],
	pairdrop: ["PairDrop 默认无需登录。"],
	tianji: ["Tianji 首次打开会进入账号/站点初始化流程；请按页面提示完成。"],
	"lobe-chat": ["LobeChat 默认无需本地账号；请在应用中配置模型 Provider/API Key 后使用。"],
	frps: ["FRPS 主要通过配置文件工作；请在 /opt/frps/config 中维护 frps.toml/frps.ini 后重启服务。"],
	maxtext: ["MaxKB 首次登录信息随镜像版本变化；请按页面提示或容器日志确认默认账号，并首次登录后修改密码。"],
};

const APP_CREDENTIAL_RULES: Record<string, AppCredentialRule> = {
	minio: {
		usernameEnv: "MINIO_ROOT_USER",
		username: "minioadmin",
		passwordEnv: "MINIO_ROOT_PASSWORD",
		forceRandomWhen: (value) => !value || value === "minioadmin",
		notes: ["MinIO Root 密码已在安装时自动生成；请首次登录后按需轮换 Root 用户或创建专用 Access Key。"],
	},
	photoprism: {
		username: "admin",
		passwordEnv: "PHOTOPRISM_ADMIN_PASSWORD",
		forceRandomWhen: (value) => !value || value === "pleasechange",
		notes: ["PhotoPrism 管理员密码已在安装时自动生成。"],
	},
	"code-server": {
		passwordEnv: "PASSWORD",
		forceRandomWhen: (value) => !value,
		notes: ["Code Server 浏览器登录密码已在安装时自动生成。"],
	},
	n8n: {
		usernameEnv: "N8N_BASIC_AUTH_USER",
		username: "admin",
		passwordEnv: "N8N_BASIC_AUTH_PASSWORD",
		forceRandomWhen: (value) => !value || value === "admin",
		notes: ["n8n Basic Auth 密码已在安装时自动生成。"],
	},
	pihole: {
		username: "admin",
		passwordEnv: "WEBPASSWORD",
		forceRandomWhen: (value) => !value || value === "changeme",
		notes: ["Pi-hole Web 管理密码已在安装时自动生成。"],
	},
	halo: {
		usernameEnv: "HALO_SECURITY_INITIALIZER_SUPERADMINUSERNAME",
		username: "admin",
		passwordEnv: "HALO_SECURITY_INITIALIZER_SUPERADMINPASSWORD",
		forceRandomWhen: (value) => !value || value === "admin123",
		notes: ["Halo 超级管理员初始密码已在安装时自动生成。"],
	},
};

function generatePassword() {
	return crypto.randomBytes(12).toString("base64url");
}

function secretLabelFromEnvKey(key: string) {
	const normalized = key.replace(/_/g, " ").toLowerCase();
	if (normalized.includes("token")) return `${key} Token`;
	if (normalized.includes("secret")) return `${key} Secret`;
	if (normalized.includes("password")) return key === "PASSWORD" ? "密码" : `${key} 密码`;
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
	if (username) credentials.push({ label: rule.usernameLabel ?? "账号", value: username });

	const currentPassword = envJson[rule.passwordEnv];
	const password = rule.forceRandomWhen?.(currentPassword) ? generatePassword() : currentPassword || generatePassword();
	envJson[rule.passwordEnv] = password;
	credentials.push({ label: rule.passwordLabel ?? "初始密码", value: password });
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
				{ label: "账号", value: "admin" },
				{ label: "初始密码", value: password },
			],
			notes: ["AList 初始管理员密码已在容器启动后自动设置。"],
		};
	}

	const rule = APP_CREDENTIAL_RULES[template.slug];
	if (rule) return applyCredentialRule(template, rule);

	const reportedKeys = new Set<string>();
	const credentials = collectStaticEnvCredentials(template.envJson, reportedKeys);
	const notes = DEFAULT_CREDENTIAL_NOTES[template.slug] ?? ["该应用未声明固定初始化账号密码；请按首次打开页面或容器日志完成初始化。"];
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
	const lines = [`${serviceName} 已安装并启动成功。`];
	if (notice.accessUrl) lines.push(`访问地址：${notice.accessUrl}`);
	if (notice.credentials.length > 0) {
		lines.push("初始化登录信息：");
		for (const credential of notice.credentials) lines.push(`${credential.label}：${credential.value}`);
	} else {
		lines.push("初始化登录信息：无固定账号密码。");
	}
	for (const note of notice.notes) lines.push(note);
	return lines.join("\n");
}
