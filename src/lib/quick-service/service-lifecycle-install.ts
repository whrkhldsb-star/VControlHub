/**
 * Install/start-container helpers for quick services.
 *
 * Split out from `service-lifecycle.ts` so the public lifecycle facade can
 * stay small while the install rollback/audit/notification path remains
 * isolated and testable.
 */
import { execFile } from "child_process";
import { promisify } from "util";

import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { createNotification } from "@/lib/notification/service";
import { buildInstallNotice, formatInstallNoticeMessage, type QuickServiceCredential } from "./install-notice";
import { dockerErrorMessage, dockerExecSync, getDockerEnvironmentStatus } from "./docker-cli";
import {
	allocatePort,
	assertTemplatePortsAvailable,
	captureQuickServiceSnapshot,
	parseCommandArgs,
	resolveEnvValue,
	safeContainerName,
	validateTemplate,
	withServiceOperationLock,
	writeQuickServiceAudit,
	type QuickServiceSnapshot,
	__internals,
} from "./service-internals";
import type { ServiceTemplate } from "./types";

const runFile = promisify(execFile);
const { normalizeVolumeEndpoint, splitContainerPathAndOptions, mkdirSync, DOCKER_SOCKET, TRUSTED_HOST_MOUNTS } = __internals;

async function rollbackInstallToSnapshot(slug: string, before: QuickServiceSnapshot | null, error: string) {
	if (!before) {
		try {
			await prisma.quickService.delete({ where: { slug } });
		} catch {
			// Record no longer exists (concurrent delete) — mark as errored instead.
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error } }).catch(() => {});
		}
		return { status: "deleted", reason: "fresh-install-failed" };
	}

	await prisma.quickService.update({
		where: { slug },
		data: {
			status: before.status,
			port: before.port,
			containerId: before.containerId,
			image: before.image,
			path: before.path,
			internalPort: before.internalPort,
			extraPortsJson: before.extraPortsJson,
			command: before.command,
			envJson: before.envJson,
			volumesJson: before.volumesJson,
			error: before.error ?? null,
		},
	});
	return { ...before, rollbackReason: "restore-previous-service-row" };
}

export interface InstallOptions {
	template: ServiceTemplate;
	userId?: string;
	customPort?: number;
	installNoticeCredentials?: QuickServiceCredential[];
	installNoticeNotes?: string[];
}
export async function installService(opts: InstallOptions) {
	const { template } = opts;
	return withServiceOperationLock(template.slug, "安装", () => installServiceUnlocked(opts));
}

async function installServiceUnlocked(opts: InstallOptions) {
	const { template, userId, customPort, installNoticeCredentials = [], installNoticeNotes = [] } = opts;

	// Pre-flight: ensure Docker is available
	const dockerStatus = getDockerEnvironmentStatus();
	if (!dockerStatus.available) {
		throw new BusinessError(`${dockerStatus.message}。${dockerStatus.installHint}`);
	}

	validateTemplate(template);
	const before = await captureQuickServiceSnapshot(template.slug);
	await writeQuickServiceAudit({
		userId,
		action: "install",
		slug: template.slug,
		status: "started",
		detail: { image: template.image, requestedPort: customPort ?? null },
		diff: { before, after: null },
	});

	const hostPort = customPort ?? allocatePort(template.defaultPort);
	assertTemplatePortsAvailable(template, hostPort);

	for (const vol of template.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "宿主机挂载");
		if (host !== DOCKER_SOCKET && !TRUSTED_HOST_MOUNTS.has(host)) {
			mkdirSync(host, { recursive: true });
		}
	}

	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const extraPortsStr = JSON.stringify(template.extraPorts ?? []);

	let svc;
	try {
		svc = await prisma.quickService.upsert({
			where: { slug: template.slug },
			update: {
				status: "installing",
				image: template.image,
				port: hostPort,
				path: template.path,
				internalPort: template.internalPort ?? null,
				extraPortsJson: extraPortsStr,
				command: template.command ?? null,
				envJson: envStr,
				volumesJson: volStr,
				error: null,
			},
			create: {
				slug: template.slug,
				name: template.name,
				category: template.category,
				icon: template.icon,
				description: template.description,
				image: template.image,
				port: hostPort,
				path: template.path,
				internalPort: template.internalPort ?? null,
				extraPortsJson: extraPortsStr,
				command: template.command ?? null,
				envJson: envStr,
				volumesJson: volStr,
				status: "installing",
				createdBy: userId ?? null,
			},
		});
	} catch (err) {
		// Upsert itself failed (db connectivity / unique constraint edge
		// case) — record a "failed" audit with the pre-install snapshot so
		// operators can see what state was supposed to be transitioned to.
		const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
		await writeQuickServiceAudit({
			userId,
			action: "install",
			slug: template.slug,
			status: "failed",
			detail: { image: template.image, port: hostPort, error: msg, phase: "upsert" },
			diff: { before, after: { status: "error", port: hostPort, error: msg } },
		});
		throw new BusinessError(`安装失败: ${msg}`);
	}

	try {
		await startDockerContainer(svc.id, template, hostPort, { userId, credentials: installNoticeCredentials, notes: installNoticeNotes });
	} catch (err) {
		let msg = dockerErrorMessage(err);
		try {
			dockerExecSync(["rm", "-f", safeContainerName(template.slug)], 15_000);
		} catch (cleanupErr) {
			msg = `${msg}; 清理残留容器失败: ${dockerErrorMessage(cleanupErr)}`;
		}
		const rollback = await rollbackInstallToSnapshot(template.slug, before, msg.slice(0, 500));
		await writeQuickServiceAudit({
			userId,
			action: "install",
			slug: template.slug,
			status: "failed",
			detail: { image: template.image, port: hostPort, error: msg.slice(0, 500), phase: "container-start", rollback: typeof rollback.status === "string" ? rollback.status : "restored" },
			diff: {
				before,
				after: rollback,
			},
		});
		await notifyQuickServiceInstallFailure(userId, template, msg);
		throw new BusinessError(`安装失败: ${msg}`);
	}

	return { ...svc, port: hostPort };
}

export async function startDockerContainer(serviceId: string, tmpl: ServiceTemplate, hostPort: number, notice?: { userId?: string; credentials?: QuickServiceCredential[]; notes?: string[] }) {
	validateTemplate(tmpl);
	const containerName = safeContainerName(tmpl.slug);

	try {
		dockerExecSync(["rm", "-f", containerName], 15_000);
	} catch {
		// Container does not exist; continue.
	}

	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const args = [
		"run",
		"-d",
		"--name",
		containerName,
		"--restart",
		"unless-stopped",
		"--add-host=host.docker.internal:host-gateway",
		"-p",
		`${hostPort}:${internalPort}`,
	];
	for (const ep of tmpl.extraPorts ?? []) args.push("-p", `${ep.host}:${ep.container}`);
	for (const vol of tmpl.volumesJson) args.push("-v", `${normalizeVolumeEndpoint(vol.host, "宿主机挂载")}:${splitContainerPathAndOptions(vol.container)}`);
	for (const [key, value] of Object.entries(tmpl.envJson)) {
		if (value !== "") args.push("-e", `${key}=${resolveEnvValue(String(value))}`);
	}
	args.push(tmpl.image, ...parseCommandArgs(tmpl.command));

	const { stdout } = await runFile("docker", args, { timeout: 300_000 });
	const containerId = stdout.trim().substring(0, 12);

	await applyPostInstallSetup(tmpl, containerName);

	await prisma.quickService.update({
		where: { id: serviceId },
		data: { status: "running", containerId, error: null },
	});
	await writeQuickServiceAudit({
		userId: notice?.userId,
		action: "install",
		slug: tmpl.slug,
		status: "succeeded",
		detail: { image: tmpl.image, port: hostPort, containerId },
		diff: {
			after: { status: "running", port: hostPort, containerId, image: tmpl.image },
		},
	});
	await notifyQuickServiceInstallSuccess(notice?.userId, tmpl, hostPort, notice?.credentials ?? [], notice?.notes ?? []);
}

async function applyPostInstallSetup(tmpl: ServiceTemplate, containerName: string) {
	if (tmpl.slug === "alist" && tmpl.initialPassword) {
		dockerExecSync(["exec", containerName, "/opt/alist/alist", "admin", "set", tmpl.initialPassword, "--data", "/opt/alist/data"], 30_000);
	}
}

async function notifyQuickServiceInstallSuccess(userId: string | undefined, tmpl: ServiceTemplate, hostPort: number, credentials: QuickServiceCredential[], notes: string[]) {
	if (!userId) return;
	try {
		const notice = buildInstallNotice(tmpl, hostPort, credentials, notes);
		await createNotification({
			userId,
			type: "system",
			title: `快捷服务安装成功：${tmpl.name}`,
			message: formatInstallNoticeMessage(tmpl.name, notice),
			actionUrl: notice.accessUrl ?? "/quick-services",
		});
	} catch {
		// Notification delivery should never flip a successfully started container into a failed install.
	}
}

async function notifyQuickServiceInstallFailure(userId: string | undefined, tmpl: ServiceTemplate, message: string) {
	if (!userId) return;
	try {
		await createNotification({
			userId,
			type: "system",
			title: `快捷服务安装失败：${tmpl.name}`,
			message: `${tmpl.name} 安装失败：${message}`,
			actionUrl: "/quick-services",
		});
	} catch {
		// Preserve the original install error even if notification persistence is unavailable.
	}
}
