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
import { execFileSync } from "child_process";

import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	dockerErrorMessage,
	dockerExec,
	getContainerHealthFor,
	getContainerLogTailFor,
	targetFromService,
	HUB_HOST_INSTANCE_KEY,
} from "./docker-cli";
import {
	assertServiceNotBusy,
	captureQuickServiceSnapshot,
	findPortLine,
	getRemovableHostVolumes,
	readListeningSockets,
	safeContainerName,
	withServiceOperationLock,
	writeQuickServiceAudit,
	__internals,
} from "./service-internals";
import { installService, startDockerContainer, type InstallOptions } from "./service-lifecycle-install";
import type { ServiceTemplate } from "./types";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/translations";

const qsLogger = createLogger("quick-service-lifecycle");

const { rmSync } = __internals;


export { installService, type InstallOptions };

export interface UninstallServiceOptions {
	deleteVolumes?: boolean;
}

const QUICK_SERVICE_LIST_SELECT = {
	id: true,
	slug: true,
	instanceKey: true,
	serverId: true,
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
	server: { select: { id: true, name: true, host: true } },
} as const;

export async function listQuickServices(instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return prisma.quickService.findMany({
		where: { instanceKey },
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

export async function getQuickService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return prisma.quickService.findUnique({
		where: { instanceKey_slug: { instanceKey, slug } },
		select: QUICK_SERVICE_LIST_SELECT,
	});
}

function serviceWhere(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return { instanceKey_slug: { instanceKey, slug } } as const;
}


export async function uninstallService(slug: string, options: UninstallServiceOptions & { instanceKey?: string } = {}) {
	const instanceKey = options.instanceKey ?? HUB_HOST_INSTANCE_KEY;
	return withServiceOperationLock(`${instanceKey}:${slug}`, "uninstall", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		assertServiceNotBusy(svc, "uninstall");
		const before = await captureQuickServiceSnapshot(slug, instanceKey);
		await writeQuickServiceAudit({
			action: "uninstall",
			slug: svc.slug,
			status: "started",
			detail: { deleteVolumes: options.deleteVolumes === true },
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		try {
			await dockerExec(targetFromService(svc), ["rm", "-f", containerName], 15_000);
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "error", error: `Uninstall failed: ${msg}` } });
			await writeQuickServiceAudit({
				action: "uninstall",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", error: `Uninstall failed: ${msg}` } },
			});
			throw new BusinessError(`Uninstall failed: ${msg}`);
		}

		if (options.deleteVolumes === true) {
			for (const hostPath of getRemovableHostVolumes(svc.volumesJson)) {
				rmSync(hostPath, { recursive: true, force: true });
			}
		}

		try {
			await prisma.quickService.delete({ where: serviceWhere(slug, instanceKey) });
		} catch (err) {
			// The container is already gone but the DB row deletion failed
			// (e.g. transient connection drop) — keep the row but mark the
			// service as stopped so a follow-up uninstall can retry the
			// delete cleanly. The diff captures the "should have been
			// deleted" intent for the audit reader.
			const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "stopped", error: `Uninstall rollback: DB delete failed ${msg}` } }).catch((err) => { qsLogger.warn("quickService status update failed", { error: err instanceof Error ? err.message : String(err) }); });
			await writeQuickServiceAudit({
				action: "uninstall",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg, phase: "db-delete" },
				diff: { before, after: { status: "stopped", error: `Uninstall rollback: DB delete failed ${msg}` } },
			});
			throw new BusinessError(`Uninstall rollback: container deleted but DB record retained, please retry uninstall: ${msg}`);
		}
		await writeQuickServiceAudit({
			action: "uninstall",
			slug: svc.slug,
			status: "succeeded",
			detail: { deleteVolumes: options.deleteVolumes === true },
			diff: { before, after: { status: "deleted" } },
		});
	});
}

export async function startService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "start", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		assertServiceNotBusy(svc, "start");
		const before = await captureQuickServiceSnapshot(slug, instanceKey);
		await writeQuickServiceAudit({
			action: "start",
			slug: svc.slug,
			status: "started",
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		const target = targetFromService(svc);
		try {
			await dockerExec(target, ["start", containerName], 30_000);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "running", error: null } });
			await writeQuickServiceAudit({
				action: "start",
				slug: svc.slug,
				status: "succeeded",
				detail: { mode: "existing-container" },
				diff: { before, after: { status: "running", mode: "existing-container" } },
			});
		} catch {
			// Container not found or start failed — fall back to re-creating it from the template.
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
				await startDockerContainer(svc.id, tmpl, svc.port, { target });
				await writeQuickServiceAudit({
					action: "start",
					slug: svc.slug,
					status: "succeeded",
					detail: { mode: "recreated-container" },
					diff: { before, after: { status: "running", mode: "recreated-container" } },
				});
			} catch (err) {
				const msg = dockerErrorMessage(err);
				await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "error", error: msg } });
				await writeQuickServiceAudit({
					action: "start",
					slug: svc.slug,
					status: "failed",
					detail: { error: msg.slice(0, 500) },
					diff: { before, after: { status: "error", error: msg.slice(0, 500) } },
				});
				throw new BusinessError(`Start failed: ${msg}`);
			}
		}
	});
}

export async function updateService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "update", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		assertServiceNotBusy(svc, "update");
		const containerName = safeContainerName(svc.slug);
		const before = await captureQuickServiceSnapshot(slug, instanceKey);
		const oldImage = svc.image;
		await writeQuickServiceAudit({
			action: "update",
			slug: svc.slug,
			status: "started",
			detail: { image: svc.image },
			diff: { before, after: null },
		});

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

		const target = targetFromService(svc);
		try {
			await dockerExec(target, ["pull", svc.image], 300_000);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "installing", error: null } });
			await startDockerContainer(svc.id, tmpl, svc.port, { target });
			const health = await getContainerHealthFor(target, containerName);
			const logTail = await getContainerLogTailFor(target, containerName);
			await writeQuickServiceAudit({
				action: "update",
				slug: svc.slug,
				status: "succeeded",
				detail: { image: svc.image, health },
				diff: {
					before,
					after: { status: "running", image: svc.image, health, oldImage },
				},
			});
			return { status: "running", health, logTail };
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "error", error: `Update failed: ${msg}` } });
			await writeQuickServiceAudit({
				action: "update",
				slug: svc.slug,
				status: "failed",
				detail: { image: svc.image, error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", image: oldImage, error: `Update failed: ${msg}` } },
			});
			throw new BusinessError(`Update failed: ${msg}`);
		}
	});
}

export async function stopService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "stop", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		assertServiceNotBusy(svc, "stop");
		const before = await captureQuickServiceSnapshot(slug, instanceKey);
		await writeQuickServiceAudit({
			action: "stop",
			slug: svc.slug,
			status: "started",
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		const target = targetFromService(svc);
		try {
			await dockerExec(target, ["stop", containerName], 30_000);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "stopped", error: null } });
			await writeQuickServiceAudit({
				action: "stop",
				slug: svc.slug,
				status: "succeeded",
				diff: { before, after: { status: "stopped" } },
			});
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "error", error: msg } });
			await writeQuickServiceAudit({
				action: "stop",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", error: msg.slice(0, 500) } },
			});
			throw new BusinessError(`Stop failed: ${msg}`);
		}
	});
}

export async function syncServiceStatus(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY) {
	const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
	if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
	const before = await captureQuickServiceSnapshot(slug, instanceKey);
	await writeQuickServiceAudit({
		action: "sync",
		slug: svc.slug,
		status: "started",
		diff: { before, after: null },
	});

	const containerName = safeContainerName(svc.slug);
	const target = targetFromService(svc);
	try {
		const state = (await dockerExec(target, ["inspect", "--format={{.State.Status}}", containerName], 10_000)).trim();
		const status = state === "running" ? "running" : "stopped";
		await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status, error: null } });
		await writeQuickServiceAudit({
			action: "sync",
			slug: svc.slug,
			status: "succeeded",
			detail: { status },
			diff: { before, after: { status, containerExisted: true } },
		});
		return status;
	} catch {
		// Container inspection failed (missing or unreachable) — treat as stopped.
		await prisma.quickService.update({ where: serviceWhere(slug, instanceKey), data: { status: "stopped" } });
		await writeQuickServiceAudit({
			action: "sync",
			slug: svc.slug,
			status: "succeeded",
			detail: { status: "stopped", missingContainer: true },
			diff: { before, after: { status: "stopped", containerExisted: false } },
		});
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
			let usedBy = "Unknown process";
			if (pidMatch) {
				const pid = pidMatch[1]!;
				if (!/^\d+$/.test(pid)) throw new ValidationError(t("backend.quick-service.invalidPid"));
				try {
					const cmdLine = execFileSync("tr", ["\0", " ", `/proc/${pid}/cmdline`], {
						timeout: 3000,
						encoding: "utf8",
					});
					usedBy = cmdLine.trim().substring(0, 80) || `PID ${pid}`;
				} catch {
					// /proc/<pid>/cmdline unreadable (process exited, permission) — use PID as label.
					usedBy = `PID ${pid}`;
				}
			}
			return { available: false, usedBy };
		}
		return { available: true, usedBy: null };
	} catch {
		// Port lookup/inspection failed — assume the port is available rather than blocking use.
		return { available: true, usedBy: null };
	}
}
