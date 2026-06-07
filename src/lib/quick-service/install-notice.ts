import crypto from "node:crypto";

import { buildQuickServiceAccessUrl } from "./access-url";
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

function generatePassword() {
	return crypto.randomBytes(12).toString("base64url");
}

export function prepareInstallSecrets(template: ServiceTemplate): {
	template: ServiceTemplate;
	credentials: QuickServiceCredential[];
	notes: string[];
} {
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

	const credentials: QuickServiceCredential[] = [];
	if (template.slug === "minio") {
		credentials.push(
			{ label: "账号", value: template.envJson.MINIO_ROOT_USER ?? "minioadmin" },
			{ label: "初始密码", value: template.envJson.MINIO_ROOT_PASSWORD ?? "minioadmin" },
		);
	} else if (template.slug === "photoprism") {
		credentials.push(
			{ label: "账号", value: "admin" },
			{ label: "初始密码", value: template.envJson.PHOTOPRISM_ADMIN_PASSWORD ?? "pleasechange" },
		);
	} else if (template.envJson.PASSWORD) {
		credentials.push({ label: "密码", value: template.envJson.PASSWORD });
	}

	return { template, credentials, notes: [] };
}

export function buildInstallNotice(template: ServiceTemplate, hostPort: number, credentials: QuickServiceCredential[], notes: string[]): QuickServiceInstallNotice {
	return {
		accessUrl: buildQuickServiceAccessUrl({
			port: hostPort,
			defaultPort: template.defaultPort,
			configuredHost: process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST,
			protocol: process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST ? "http:" : undefined,
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
		lines.push("该应用未提供固定初始化账号密码；如首次访问需要注册/初始化，请按应用页面提示完成。不同镜像可能会在容器日志中输出一次性密码。 ");
	}
	for (const note of notice.notes) lines.push(note);
	return lines.join("\n");
}
