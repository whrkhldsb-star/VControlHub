import { ownedContainer } from "./container-ownership";
import { collectOptionPages } from "@/lib/server/option-pages";
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
import { open } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { ConflictError, BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import { t } from "@/lib/i18n/service-translations";
import {
	dockerErrorMessage,
	dockerExec,
	getContainerHealthFor,
	getContainerLogTailFor,
	isDockerNoSuchContainerError,
	assertContainerStarted,
	HUB_HOST_INSTANCE_KEY,
	type DockerTarget,
} from "./docker-cli";
import {
	assertServiceNotBusy,
	captureQuickServiceSnapshot,
	findPortLine,
	getRemovableHostVolumes,
	assertExclusiveHostVolumes,
	removeExclusiveHostVolumes,
	readListeningSockets,
	safeContainerName,
	withServiceOperationLock,
	writeQuickServiceAudit,
} from "./service-internals";
import { ContainerCommittedError, installService, recreateDockerContainer } from "./service-lifecycle-install";
import { resolveQuickServiceExecutionTarget, type QuickServiceRequester } from "./execution-authorization";
import { SERVICE_CATALOG } from "./catalog";
import type { ServiceTemplate } from "./types";
import { createLogger } from "@/lib/logging";

const qsLogger = createLogger("quick-service-lifecycle");


export { installService };

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

export async function listQuickServices(instanceKey: string = HUB_HOST_INSTANCE_KEY, teamId?: string | null) {
	return collectOptionPages(page => prisma.quickService.findMany({
		where: {
			instanceKey, serverId: instanceKey === HUB_HOST_INSTANCE_KEY ? null : instanceKey,
			...(instanceKey !== HUB_HOST_INSTANCE_KEY && teamId !== undefined ? { server: { teamId } } : {}),
		},
		orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
		...page,
		select: QUICK_SERVICE_LIST_SELECT,
	}));
}

export async function listQuickServiceHistory(limit = 20) {
	return prisma.auditLog.findMany({
		where: { action: { startsWith: "quick_service." } },
		orderBy: { createdAt: "desc" },
		take: Math.max(1, Math.min(limit, 50)),
		select: { id: true, action: true, severity: true, detail: true, createdAt: true, actor: { select: { username: true, displayName: true } } },
	});
}

function serviceWhere(slug: string, instanceKey: string, target?: DockerTarget) {
	return {
		instanceKey_slug: { instanceKey, slug },
		...(target?.kind === "remote" && target.expectedTeamId !== undefined ? { server: { id: target.serverId, teamId: target.expectedTeamId, ...target.endpoint } } : {}),
	};
}


export async function uninstallService(slug: string, options: UninstallServiceOptions & { instanceKey?: string; requester?: QuickServiceRequester } = {}) {
	const instanceKey = options.instanceKey ?? HUB_HOST_INSTANCE_KEY;
	return withServiceOperationLock(`${instanceKey}:${slug}`, "uninstall", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		const target = await resolveQuickServiceExecutionTarget(svc, instanceKey, "uninstall", options.requester);
		assertServiceNotBusy(svc, "uninstall");
		const hostPaths = options.deleteVolumes ? getRemovableHostVolumes(svc.volumesJson) : [];
		if (target.kind === "local") await assertExclusiveHostVolumes(svc.id, hostPaths);
		const before = await captureQuickServiceSnapshot(slug, instanceKey, target);
		await writeQuickServiceAudit({
			target,
			action: "uninstall",
			slug: svc.slug,
			status: "started",
			detail: { deleteVolumes: options.deleteVolumes === true },
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		try {
			const id = await ownedContainer(target, containerName, svc.id, { storedId: svc.containerId });
			if (id) await dockerExec(target, ["rm", "-f", id], 15_000);
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: `Uninstall failed: ${msg}` } });
			await writeQuickServiceAudit({
				target,
				action: "uninstall",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", error: `Uninstall failed: ${msg}` } },
			});
			if (err instanceof ConflictError) throw err;
			throw new BusinessError(
				t("backend.quick-service.uninstallFailedWithMessage", {
					message: msg,
				}),
			);
		}

		if (options.deleteVolumes === true) {
			// Host paths in volumesJson live on the Docker host. Hub-side
			// rmSync is only safe for local installs; remote installs must
			// not wipe hub paths that merely share the same string.
			if (target.kind === "local") {
				await removeExclusiveHostVolumes(svc.id, hostPaths);
			} else {
				if (hostPaths.length > 0) {
					qsLogger.warn("skipping hub-local volume rmSync for remote quick-service uninstall; remote data left for operator cleanup", {
						slug: svc.slug,
						instanceKey,
						serverId: svc.serverId,
						hostPaths,
					});
				}
			}
		}

		try {
			await prisma.quickService.delete({ where: serviceWhere(slug, instanceKey, target) });
		} catch (err) {
			// The container is already gone but the DB row deletion failed
			// (e.g. transient connection drop) — keep the row but mark the
			// service as stopped so a follow-up uninstall can retry the
			// delete cleanly. The diff captures the "should have been
			// deleted" intent for the audit reader.
			const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "stopped", error: `Uninstall rollback: DB delete failed ${msg}` } }).catch((err) => { qsLogger.warn("quickService status update failed", { error: err instanceof Error ? err.message : String(err) }); });
			await writeQuickServiceAudit({
				target,
				action: "uninstall",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg, phase: "db-delete" },
				diff: { before, after: { status: "stopped", error: `Uninstall rollback: DB delete failed ${msg}` } },
			});
			throw new BusinessError(
				t("backend.quick-service.uninstallRollbackFailed", { message: msg }),
			);
		}
		await writeQuickServiceAudit({
			target,
			action: "uninstall",
			slug: svc.slug,
			status: "succeeded",
			detail: { deleteVolumes: options.deleteVolumes === true },
			diff: { before, after: { status: "deleted" } },
		});
	});
}

export async function startService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY, requester?: QuickServiceRequester) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "start", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		const target = await resolveQuickServiceExecutionTarget(svc, instanceKey, "start", requester);
		assertServiceNotBusy(svc, "start");
		const before = await captureQuickServiceSnapshot(slug, instanceKey, target);
		await writeQuickServiceAudit({
			target,
			action: "start",
			slug: svc.slug,
			status: "started",
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		const id = await ownedContainer(target, containerName, svc.id, { storedId: svc.containerId });
		let startError: unknown = null;
		try {
			if (id) await dockerExec(target, ["start", id], 30_000);
		} catch (error) {
			startError = error;
		}
		if (id && !startError) {
			// `docker start` returning only means the start was accepted: hold an
			// existing container to the same acceptance as a new one, or one
			// whose process exits at once was recorded as running.
			try {
				await assertContainerStarted(target, id);
			} catch (error) {
				const msg = dockerErrorMessage(error);
				await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: msg } });
				await writeQuickServiceAudit({
					target,
					action: "start",
					slug: svc.slug,
					status: "failed",
					detail: { mode: "existing-container", error: msg.slice(0, 500) },
					diff: { before, after: { status: "error", mode: "existing-container" } },
				});
				throw error;
			}
			// Bookkeeping failures after a successful start propagate as-is; they
			// must not fall into the recreate path below.
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "running", error: null } });
			await writeQuickServiceAudit({
				target,
				action: "start",
				slug: svc.slug,
				status: "succeeded",
				detail: { mode: "existing-container" },
				diff: { before, after: { status: "running", mode: "existing-container" } },
			});
			return;
		}
		if (startError && !isDockerNoSuchContainerError(startError)) {
			// The container exists (or its state is unknown) but would not start:
			// re-creating it would not fix that and would replace a container the
			// operator may need to inspect.
			const msg = dockerErrorMessage(startError);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: msg } });
			await writeQuickServiceAudit({
				target,
				action: "start",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg.slice(0, 500), mode: "existing-container" },
				diff: { before, after: { status: "error", error: msg.slice(0, 500) } },
			});
			throw new BusinessError(t("backend.quick-service.startFailedWithMessage", { message: msg }));
		}
		{
			// The container is gone — re-create it from the stored template.
			const tmpl = templateFromStoredService(svc);
			try {
				await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "installing", error: null } });
				await recreateDockerContainer(svc.id, tmpl, svc.port, { target, previousId: svc.containerId, auditAction: "start" });
				await writeQuickServiceAudit({
					target,
					action: "start",
					slug: svc.slug,
					status: "succeeded",
					detail: { mode: "recreated-container" },
					diff: { before, after: { status: "running", mode: "recreated-container" } },
				});
			} catch (err) {
				if (err instanceof ContainerCommittedError) throw err;
				const msg = dockerErrorMessage(err);
				await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: msg } });
				await writeQuickServiceAudit({
					target,
					action: "start",
					slug: svc.slug,
					status: "failed",
					detail: { error: msg.slice(0, 500) },
					diff: { before, after: { status: "error", error: msg.slice(0, 500) } },
				});
				throw new BusinessError(
					t("backend.quick-service.startFailedWithMessage", { message: msg }),
				);
			}
		}
	});
}

/**
 * The template to re-create a stored service from (start after the container was removed, update). The row keeps
 * the host port, but the port inside the container is a fact of the image: a template without an internalPort
 * listens on its default port, and that is not the host port the user chose at install. Rebuilt from the host
 * port, an app installed on 18096 became `-p 18096:18096` and answered nowhere while showing "running". The
 * built-in catalog entry supplies what the row does not hold (the internal port, and the permission to mount the
 * Docker socket, which Portainer and Gladys need and which validation otherwise refuses).
 */
export function templateFromStoredService(svc: {
	slug: string; name: string; category: string; icon: string; description: string; image: string; port: number;
	internalPort: number | null; path: string; envJson: string; volumesJson: string; extraPortsJson: string | null; command: string | null;
}): ServiceTemplate {
	const builtIn = SERVICE_CATALOG.find((entry) => entry.slug === svc.slug);
	return {
		slug: svc.slug,
		name: svc.name,
		category: svc.category,
		icon: svc.icon,
		description: svc.description,
		image: svc.image,
		defaultPort: builtIn?.defaultPort ?? svc.port,
		// A built-in entry that names the image's port wins over the row: installs made before the entry named it
		// stored the host port's default there (8110 for File Browser, which listens on 80) and stayed unreachable
		// through every update.
		internalPort: builtIn?.internalPort ?? svc.internalPort ?? builtIn?.defaultPort ?? undefined,
		path: svc.path,
		envJson: JSON.parse(svc.envJson),
		volumesJson: JSON.parse(svc.volumesJson),
		extraPorts: JSON.parse(svc.extraPortsJson || "[]"),
		command: svc.command ?? undefined,
		...(builtIn?.allowDockerSocket ? { allowDockerSocket: true } : {}),
	};
}

export async function updateService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY, requester?: QuickServiceRequester) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "update", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		const target = await resolveQuickServiceExecutionTarget(svc, instanceKey, "update", requester);
		assertServiceNotBusy(svc, "update");
		const containerName = safeContainerName(svc.slug);
		const before = await captureQuickServiceSnapshot(slug, instanceKey, target);
		const oldImage = svc.image;
		await writeQuickServiceAudit({
			target,
			action: "update",
			slug: svc.slug,
			status: "started",
			detail: { image: svc.image },
			diff: { before, after: null },
		});

		const tmpl = templateFromStoredService(svc);

		try {
			await dockerExec(target, ["pull", svc.image], 300_000);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "installing", error: null } });
			await recreateDockerContainer(svc.id, tmpl, svc.port, { target, previousId: svc.containerId, auditAction: "update" });
			const health = await getContainerHealthFor(target, containerName);
			const logTail = await getContainerLogTailFor(target, containerName);
			await writeQuickServiceAudit({
				target,
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
			if (err instanceof ContainerCommittedError) throw err;
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: `Update failed: ${msg}` } });
			await writeQuickServiceAudit({
				target,
				action: "update",
				slug: svc.slug,
				status: "failed",
				detail: { image: svc.image, error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", image: oldImage, error: `Update failed: ${msg}` } },
			});
			if (err instanceof ConflictError) throw err;
			throw new BusinessError(
				t("backend.quick-service.updateFailedWithMessage", { message: msg }),
			);
		}
	});
}

export async function stopService(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY, requester?: QuickServiceRequester) {
	return withServiceOperationLock(`${instanceKey}:${slug}`, "stop", async () => {
		const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
		if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
		const target = await resolveQuickServiceExecutionTarget(svc, instanceKey, "stop", requester);
		assertServiceNotBusy(svc, "stop");
		const before = await captureQuickServiceSnapshot(slug, instanceKey, target);
		await writeQuickServiceAudit({
			target,
			action: "stop",
			slug: svc.slug,
			status: "started",
			diff: { before, after: null },
		});

		const containerName = safeContainerName(svc.slug);
		try {
			const id = await ownedContainer(target, containerName, svc.id, { storedId: svc.containerId });
			if (id) await dockerExec(target, ["stop", id], 30_000);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "stopped", error: null } });
			await writeQuickServiceAudit({
				target,
				action: "stop",
				slug: svc.slug,
				status: "succeeded",
				diff: { before, after: { status: "stopped" } },
			});
		} catch (err) {
			const msg = dockerErrorMessage(err);
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "error", error: msg } });
			await writeQuickServiceAudit({
				target,
				action: "stop",
				slug: svc.slug,
				status: "failed",
				detail: { error: msg.slice(0, 500) },
				diff: { before, after: { status: "error", error: msg.slice(0, 500) } },
			});
			throw new BusinessError(
				t("backend.quick-service.stopFailedWithMessage", { message: msg }),
			);
		}
	});
}

export async function syncServiceStatus(slug: string, instanceKey: string = HUB_HOST_INSTANCE_KEY, requester?: QuickServiceRequester) {
	const svc = await prisma.quickService.findUnique({ where: serviceWhere(slug, instanceKey) });
	if (!svc) throw new NotFoundError(t("backend.quick-service.serviceNotFound"));
	const target = await resolveQuickServiceExecutionTarget(svc, instanceKey, "sync", requester);
	const before = await captureQuickServiceSnapshot(slug, instanceKey, target);
	await writeQuickServiceAudit({
		target,
		action: "sync",
		slug: svc.slug,
		status: "started",
		diff: { before, after: null },
	});

	const containerName = safeContainerName(svc.slug);
	async function missing() {
		await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { status: "stopped", containerId: null } });
		await writeQuickServiceAudit({
			target,
			action: "sync",
			slug,
			status: "succeeded",
			detail: { status: "stopped", missingContainer: true },
			diff: { before, after: { status: "stopped", containerExisted: false } },
		});
		return "stopped";
	}
	try {
		// The container that exists now, with its id: an install whose final
		// save failed left the row "installing" with the replaced container's id.
		const id = await ownedContainer(target, containerName, svc.id, { storedId: svc.containerId, reconcile: svc.status === "installing" });
		if (!id) return missing();
		const [state = "", containerId = ""] = (await dockerExec(target, ["inspect", "--format={{.State.Status}}|{{.Id}}", id], 10_000)).trim().split("|");
		const status = state === "running" ? "running" : "stopped";
		await prisma.quickService.update({
			where: serviceWhere(slug, instanceKey, target),
			data: { status, error: null, ...(containerId ? { containerId: containerId.slice(0, 64) } : {}) },
		});
		await writeQuickServiceAudit({
			target,
			action: "sync",
			slug: svc.slug,
			status: "succeeded",
			detail: { status },
			diff: { before, after: { status, containerExisted: true } },
		});
		return status;
	} catch (error) {
		// Only Docker saying the container does not exist means stopped. A
		// timeout or an unreachable host says nothing about the container:
		// keep the recorded status, record why, and let the refresh fail.
		const message = dockerErrorMessage(error);
		if (!isDockerNoSuchContainerError(error)) {
			await prisma.quickService.update({ where: serviceWhere(slug, instanceKey, target), data: { error: message.slice(0, 1000) } });
			await writeQuickServiceAudit({
				target,
				action: "sync",
				slug: svc.slug,
				status: "failed",
				detail: { error: message.slice(0, 500) },
				diff: { before, after: null },
			});
			throw new BusinessError(message.slice(0, 500));
		}
		return missing();
	}
}

export async function checkPort(port: number): Promise<{ available: boolean; usedBy: string | null }> {
	if (!isValidTcpPort(port)) {
		return { available: false, usedBy: null };
	}
	try {
		const found = findPortLine(await readListeningSockets(), port);
		if (found) {
			const pidMatch = found.match(/pid=(\d+)/);
			let usedBy = "Unknown process";
			if (pidMatch) {
				const pid = pidMatch[1]!;
				if (!/^\d+$/.test(pid)) throw new ValidationError(t("backend.quick-service.invalidPid"));
				try {
					const file = await open(`/proc/${pid}/cmdline`, "r");
					try {
						const buffer = Buffer.alloc(512);
						const { bytesRead } = await file.read(buffer);
						usedBy = buffer.toString("utf8", 0, bytesRead).replaceAll("\0", " ").trim().slice(0, 80) || `PID ${pid}`;
					} finally { await file.close(); }
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
