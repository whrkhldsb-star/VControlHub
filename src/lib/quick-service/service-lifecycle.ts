/**
 * Public lifecycle API for quick services (install / uninstall / start /
 * stop / update / sync) plus the read-only listing helpers and the port
 * availability probe used by the install form.
 *
 * Extracted from the previous `lib/quick-service/service.ts` god-file as
 * part of R28. The helpers used internally (port allocation, template
 * validation, audit writer, op lock) now live in `./service-internals`
 * and are imported here.
 */
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";

import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notification/service";
import { buildInstallNotice, formatInstallNoticeMessage, type QuickServiceCredential } from "./install-notice";
import {
	dockerErrorMessage,
	dockerExecSync,
	getContainerHealth,
	getContainerLogTail,
	getDockerEnvironmentStatus,
} from "./docker-cli";
import {
	allocatePort,
	assertServiceNotBusy,
	assertTemplatePortsAvailable,
	findPortLine,
	getRemovableHostVolumes,
	parseCommandArgs,
	readListeningSockets,
	resolveEnvValue,
	safeContainerName,
	validateTemplate,
	withServiceOperationLock,
	writeQuickServiceAudit,
	__internals,
} from "./service-internals";
import type { ServiceTemplate } from "./types";

const runFile = promisify(execFile);

const { normalizeVolumeEndpoint, splitContainerPathAndOptions, mkdirSync, rmSync, DOCKER_SOCKET, TRUSTED_HOST_MOUNTS } = __internals;

export interface InstallOptions {
	template: ServiceTemplate;
	userId?: string;
	customPort?: number;
	installNoticeCredentials?: QuickServiceCredential[];
	installNoticeNotes?: string[];
}

export interface UninstallServiceOptions {
	deleteVolumes?: boolean;
}

const QUICK_SERVICE_LIST_SELECT = {
	id: true,
	slug: true,
	name: true,
	category: true,
	description: true,
	icon: true,
	image: true,
	port: true,
	path: true,
	internalPort: true,
	extraPortsJson: true,
	command: true,
	envJson: true,
	volumesJson: true,
	status: true,
	containerId: true,
	error: true,
	createdAt: true,
} as const;

export async function listQuickServices() {
	return prisma.quickService.findMany({
		orderBy: [{ category: "asc" }, { name: "asc" }],
		take: 200,
		select: QUICK_SERVICE_LIST_SELECT,
	});
}

export async function listQuickServiceHistory(limit = 20) {
	return prisma.auditLog.findMany({
		where: { action: { startsWith: "quick_service." } },
		orderBy: { createdAt: "desc" },
		take: Math.max(1, Math.min(limit, 50)),
		select: { id: true, action: true, severity: true, detail: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
	});
}

export async function getQuickService(slug: string) {
	return prisma.quickService.findUnique({
		where: { slug },
		select: QUICK_SERVICE_LIST_SELECT,
	});
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
		throw new Error(`${dockerStatus.message}。${dockerStatus.installHint}`);
	}

	validateTemplate(template);
	await writeQuickServiceAudit({ userId, action: "install", slug: template.slug, status: "started", detail: { image: template.image, requestedPort: customPort ?? null } });
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
	const svc = await prisma.quickService.upsert({
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

	startDockerContainer(svc.id, template, hostPort, { userId, credentials: installNoticeCredentials, notes: installNoticeNotes }).catch(async (err) => {
		let msg = dockerErrorMessage(err);
		try {
			dockerExecSync(["rm", "-f", safeContainerName(template.slug)], 15_000);
		} catch (cleanupErr) {
			msg = `${msg}; 清理残留容器失败: ${dockerErrorMessage(cleanupErr)}`;
		}
		await prisma.quickService.update({ where: { id: svc.id }, data: { status: "error", error: msg } });
		await writeQuickServiceAudit({ userId, action: "install", slug: template.slug, status: "failed", detail: { image: template.image, port: hostPort, error: msg.slice(0, 500) } });
		await notifyQuickServiceInstallFailure(userId, template, msg);
	});

	return { ...svc, port: hostPort };
}

async function startDockerContainer(serviceId: string, tmpl: ServiceTemplate, hostPort: number, notice?: { userId?: string; credentials?: QuickServiceCredential[]; notes?: string[] }) {
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
	await writeQuickServiceAudit({ userId: notice?.userId, action: "install", slug: tmpl.slug, status: "succeeded", detail: { image: tmpl.image, port: hostPort, containerId } });
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

export async function uninstallService(slug: string, options: UninstallServiceOptions = {}) {
	return withServiceOperationLock(slug, "卸载", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "卸载");
		await writeQuickServiceAudit({ action: "uninstall", slug: svc.slug, status: "started", detail: { deleteVolumes: options.deleteVolumes === true } });

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["rm", "-f", containerName], 15_000);
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error: `卸载失败: ${msg}` } });
			await writeQuickServiceAudit({ action: "uninstall", slug: svc.slug, status: "failed", detail: { error: msg.slice(0, 500) } });
			throw new Error(`卸载失败: ${msg}`);
		}

		if (options.deleteVolumes === true) {
			for (const hostPath of getRemovableHostVolumes(svc.volumesJson)) {
				rmSync(hostPath, { recursive: true, force: true });
			}
		}

		await prisma.quickService.delete({ where: { slug } });
		await writeQuickServiceAudit({ action: "uninstall", slug: svc.slug, status: "succeeded", detail: { deleteVolumes: options.deleteVolumes === true } });
	});
}

export async function startService(slug: string) {
	return withServiceOperationLock(slug, "启动", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "启动");
		await writeQuickServiceAudit({ action: "start", slug: svc.slug, status: "started" });

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["start", containerName], 30_000);
			await prisma.quickService.update({ where: { slug }, data: { status: "running", error: null } });
			await writeQuickServiceAudit({ action: "start", slug: svc.slug, status: "succeeded", detail: { mode: "existing-container" } });
		} catch {
			const tmpl: ServiceTemplate = {
				slug: svc.slug,
				name: svc.name,
				category: svc.category,
				icon: svc.icon,
				description: svc.description,
				image: svc.image,
				defaultPort: svc.port,
				internalPort: svc.internalPort ?? undefined,
				path: svc.path,
				envJson: JSON.parse(svc.envJson),
				volumesJson: JSON.parse(svc.volumesJson),
				extraPorts: JSON.parse(svc.extraPortsJson || "[]"),
				command: svc.command ?? undefined,
			};
			try {
				await startDockerContainer(svc.id, tmpl, svc.port);
				await writeQuickServiceAudit({ action: "start", slug: svc.slug, status: "succeeded", detail: { mode: "recreated-container" } });
			} catch (err) {
				const msg = dockerErrorMessage(err);
				await prisma.quickService.update({ where: { slug }, data: { status: "error", error: msg } });
				await writeQuickServiceAudit({ action: "start", slug: svc.slug, status: "failed", detail: { error: msg.slice(0, 500) } });
				throw new Error(`启动失败: ${msg}`);
			}
		}
	});
}

export async function updateService(slug: string) {
	return withServiceOperationLock(slug, "更新", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "更新");
		const containerName = safeContainerName(svc.slug);
		await writeQuickServiceAudit({ action: "update", slug: svc.slug, status: "started", detail: { image: svc.image } });

		const tmpl: ServiceTemplate = {
			slug: svc.slug,
			name: svc.name,
			category: svc.category,
			icon: svc.icon,
			description: svc.description,
			image: svc.image,
			defaultPort: svc.port,
			internalPort: svc.internalPort ?? undefined,
			path: svc.path,
			envJson: JSON.parse(svc.envJson),
			volumesJson: JSON.parse(svc.volumesJson),
			extraPorts: JSON.parse(svc.extraPortsJson || "[]"),
			command: svc.command ?? undefined,
		};

		try {
			dockerExecSync(["pull", svc.image], 300_000);
			await prisma.quickService.update({ where: { slug }, data: { status: "installing", error: null } });
			await startDockerContainer(svc.id, tmpl, svc.port);
			const health = getContainerHealth(containerName);
			const logTail = getContainerLogTail(containerName);
			await writeQuickServiceAudit({ action: "update", slug: svc.slug, status: "succeeded", detail: { image: svc.image, health } });
			return { status: "running", health, logTail };
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error: `更新失败: ${msg}` } });
			await writeQuickServiceAudit({ action: "update", slug: svc.slug, status: "failed", detail: { image: svc.image, error: msg.slice(0, 500) } });
			throw new Error(`更新失败: ${msg}`);
		}
	});
}

export async function stopService(slug: string) {
	return withServiceOperationLock(slug, "停止", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "停止");
		await writeQuickServiceAudit({ action: "stop", slug: svc.slug, status: "started" });

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["stop", containerName], 30_000);
			await prisma.quickService.update({ where: { slug }, data: { status: "stopped", error: null } });
			await writeQuickServiceAudit({ action: "stop", slug: svc.slug, status: "succeeded" });
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error: msg } });
			await writeQuickServiceAudit({ action: "stop", slug: svc.slug, status: "failed", detail: { error: msg.slice(0, 500) } });
			throw new Error(`停止失败: ${msg}`);
		}
	});
}

export async function syncServiceStatus(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");
	await writeQuickServiceAudit({ action: "sync", slug: svc.slug, status: "started" });

	const containerName = safeContainerName(svc.slug);
	try {
		const state = dockerExecSync(["inspect", "--format={{.State.Status}}", containerName], 10_000).trim();
		const status = state === "running" ? "running" : "stopped";
		await prisma.quickService.update({ where: { slug }, data: { status, error: null } });
		await writeQuickServiceAudit({ action: "sync", slug: svc.slug, status: "succeeded", detail: { status } });
		return status;
	} catch {
		await prisma.quickService.update({ where: { slug }, data: { status: "stopped" } });
		await writeQuickServiceAudit({ action: "sync", slug: svc.slug, status: "succeeded", detail: { status: "stopped", missingContainer: true } });
		return "stopped";
	}
}

export function checkPort(port: number): { available: boolean; usedBy: string | null } {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { available: false, usedBy: null };
	}
	try {
		const found = findPortLine(readListeningSockets(), port);
		if (found) {
			const pidMatch = found.match(/pid=(\d+)/);
			let usedBy = "未知进程";
			if (pidMatch) {
				const pid = pidMatch[1];
				if (!/^\d+$/.test(pid)) throw new Error("Invalid PID");
				try {
					const cmdLine = execFileSync("tr", ["\0", " ", `/proc/${pid}/cmdline`], {
						timeout: 3000,
						encoding: "utf8",
					});
					usedBy = cmdLine.trim().substring(0, 80) || `PID ${pid}`;
				} catch {
					usedBy = `PID ${pid}`;
				}
			}
			return { available: false, usedBy };
		}
		return { available: true, usedBy: null };
	} catch {
		return { available: true, usedBy: null };
	}
}
