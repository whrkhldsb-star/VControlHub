import { randomUUID } from "node:crypto";
import { INSTANCE_LABEL, INSTALL_LABEL, ownedContainer } from "./container-ownership";
import { verifyDockerMounts } from "./mount-check";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Install/start-container helpers for quick services.
 *
 * Split out from `service-lifecycle.ts` so the public lifecycle facade can
 * stay small while the install rollback/audit/notification path remains
 * isolated and testable.
 */
import { prisma } from "@/lib/db";
import { ConflictError, BusinessError } from "@/lib/errors";
import { createNotification } from "@/lib/notification/service";
import { t } from "@/lib/i18n/service-translations";
import { buildInstallNotice, formatInstallNoticeMessage, type QuickServiceCredential } from "./install-notice";
import {
	dockerErrorMessage,
	dockerExec,
	dockerRun,
	assertContainerStarted,
	getDockerEnvironmentStatusFor,
	instanceKeyForTarget,
	isRemotePortAvailable,
	type DockerTarget,
} from "./docker-cli";
import {
	allocatePort,
	assertTemplatePortsAvailable,
	readQuickServiceSnapshot,
	parseCommandArgs,
	releasePortReservations,
	safeContainerName,
	templateReservedPorts,
	validateTemplate,
	withPortAllocationLock,
	withServiceOperationLock,
	writeQuickServiceAudit,
	type QuickServiceSnapshot,
	__internals,
} from "./service-internals";
import type { ServiceTemplate } from "./types";
import { hubHostDockerSocketMount } from "@/lib/runtime/platform-paths";

const { normalizeVolumeEndpoint, splitContainerPathAndOptions, DOCKER_SOCKET, TRUSTED_HOST_MOUNTS } = __internals;

/** The container started and passed acceptance, but its final database write failed. */
export class ContainerCommittedError extends Error {
	constructor(readonly containerId: string, readonly cause: unknown) {
		super("Quick service container is running but its final state could not be saved");
		this.name = "ContainerCommittedError";
	}
}

async function rollbackInstallToSnapshot(
	where: { id: string; instanceKey: string; slug: string; serverId: string | null },
	before: QuickServiceSnapshot | null,
) {
	if (!before) {
		await prisma.quickService.delete({ where });
		return { status: "deleted", reason: "fresh-install-failed" };
	}

	await prisma.quickService.update({
		where,
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
	/** Defaults to hub-host local Docker. Remote installs set {kind:"remote", serverId}. */
	target?: DockerTarget;
	installNoticeCredentials?: QuickServiceCredential[];
	installNoticeNotes?: string[];
}
export async function installService(opts: InstallOptions) {
	const target: DockerTarget = opts.target ?? { kind: "local" };
	const lockKey = `${instanceKeyForTarget(target)}:${opts.template.slug}`;
	return withServiceOperationLock(lockKey, "install", () => installServiceUnlocked(opts));
}

async function installServiceUnlocked(opts: InstallOptions) {
	const { template, userId, customPort, installNoticeCredentials = [], installNoticeNotes = [] } = opts;
	const target: DockerTarget = opts.target ?? { kind: "local" };
	const instanceKey = instanceKeyForTarget(target);
	const serverId = target.kind === "remote" ? target.serverId : null;
	const identity = { instanceKey, serverId, slug: template.slug };
	const server = target.kind === "remote" ? { id: target.serverId, teamId: target.expectedTeamId, ...target.endpoint } : undefined;
	const ownerScope = server ? { server } : {};
	const before = await readQuickServiceSnapshot(template.slug, instanceKey, target);

	// Pre-flight: ensure Docker is available on the selected target
	const dockerStatus = await getDockerEnvironmentStatusFor(target);
	if (!dockerStatus.available) {
		throw new BusinessError(apiCopy("apiCopy..b8832c6a", { v0: String(dockerStatus.message), v1: String(dockerStatus.installHint) }));
	}

	validateTemplate(template);
	await writeQuickServiceAudit({
		target,
		userId,
		action: "install",
		slug: template.slug,
		status: "started",
		detail: { image: template.image, requestedPort: customPort ?? null },
		diff: { before, after: null },
	});

	// Port allocation:
	// - local: allocate/reserve on hub OS (held until docker bind)
	// - remote: probe VPS via SSH; never use hub-local free-port heuristics
	const portScope = target.kind === "local" ? "hub-host" : target.serverId;
	const owner = Symbol("quick-service install");
	let reservedPorts: number[] = [];
	const hostPort = await withPortAllocationLock(portScope, async () => {
		if (target.kind === "remote") {
			const extras = templateReservedPorts(template, customPort ?? template.defaultPort).slice(1);
			for (const port of extras) {
				if (!await isRemotePortAvailable(target, port)) throw new BusinessError(t("backend.quick-service.extraPortInUseOnTarget", { port }));
			}
			if (customPort) {
				if (!await isRemotePortAvailable(target, customPort)) throw new BusinessError(t("backend.quick-service.portInUseOnTarget", { port: customPort }));
				return customPort;
			}
			for (let i = 0; i <= 40; i++) {
				const candidate = i === 0 ? template.defaultPort : 10000 + Math.floor(Math.random() * 55536);
				if (!extras.includes(candidate) && await isRemotePortAvailable(target, candidate)) return candidate;
			}
			throw new BusinessError(
				t("backend.quick-service.noAvailablePortOnTarget"),
			);
		}
		const port = customPort ?? (await allocatePort(template.defaultPort, owner));
		try { await assertTemplatePortsAvailable(template, port, owner); }
		catch (error) { releasePortReservations([port], owner); throw error; }
		reservedPorts = templateReservedPorts(template, port);
		return port;
	});

	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const extraPortsStr = JSON.stringify(template.extraPorts ?? []);

	let svc;
	try {
		const configuration = {
			status: "installing", image: template.image, port: hostPort, path: template.path,
			internalPort: template.internalPort ?? template.defaultPort,
			extraPortsJson: extraPortsStr, command: template.command ?? null, envJson: envStr,
			volumesJson: volStr, error: null,
		};
		// A concurrent insert after an empty snapshot must conflict. Updating it
		// would make our fresh-install rollback delete someone else's row.
		svc = before
			? await prisma.quickService.update({ where: { id: before.id, ...identity, ...ownerScope }, data: configuration })
			: await prisma.quickService.create({
				data: {
					instanceKey, slug: template.slug, ...(server && { server: { connect: server } }),
					...configuration, name: template.name, category: template.category,
					icon: template.icon, description: template.description, createdBy: userId ?? null,
				},
			});
	} catch (err) {
		if (reservedPorts.length > 0) releasePortReservations(reservedPorts, owner);
		// The conditional write failed. Record the pre-install snapshot so
		// operators can see what state was supposed to be transitioned to.
		const msg = err instanceof Error ? err.message.slice(0, 500) : String(err);
		await writeQuickServiceAudit({
			target,
			userId,
			action: "install",
			slug: template.slug,
			status: "failed",
			detail: { image: template.image, port: hostPort, error: msg, phase: "upsert" },
			diff: { before, after: { status: "error", port: hostPort, error: msg } },
		});
		throw new BusinessError(
			t("backend.quick-service.installFailedWithMessage", { message: msg }),
		);
	}

	try {
		return await recreateDockerContainer(svc.id, template, hostPort, { userId, credentials: installNoticeCredentials, notes: installNoticeNotes, target, previousId: before?.containerId });
	} catch (err) {
		if (err instanceof ContainerCommittedError) {
			// Running and accepted; only its final bookkeeping failed. The row
			// already holds the new configuration: keep it, do not roll back.
			const msg = dockerErrorMessage(err.cause);
			await writeQuickServiceAudit({
				target,
				userId,
				action: "install",
				slug: template.slug,
				status: "failed",
				detail: { image: template.image, port: hostPort, error: msg.slice(0, 500), phase: "finalize", containerId: err.containerId },
				diff: { before, after: { status: "unknown", containerId: err.containerId } },
			}).catch(() => undefined);
			throw new BusinessError(t("backend.quick-service.installFailedWithMessage", { message: msg }));
		}
		// recreateDockerContainer already removed any container it created and
		// restored a previous one; removing the container name again here would
		// delete that restored container (or a healthy one whose bookkeeping
		// failed afterwards).
		const msg = dockerErrorMessage(err);
		const rollback = await rollbackInstallToSnapshot({ id: svc.id, ...identity, ...ownerScope }, before);
		await writeQuickServiceAudit({
			target,
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
		await notifyQuickServiceInstallFailure(userId, template, msg, target);
		if (err instanceof ConflictError) throw err;
		throw new BusinessError(
			t("backend.quick-service.installFailedWithMessage", { message: msg }),
		);
	} finally {
		releasePortReservations(reservedPorts, owner);
	}
}

/**
 * Package-internal recreate helper (rename/rm then create). Not re-exported from
 * the public quick-service barrel — use installService / startService / updateService.
 */
export async function recreateDockerContainer(
	serviceId: string,
	tmpl: ServiceTemplate,
	hostPort: number,
	notice?: { previousId?: string | null; userId?: string; credentials?: QuickServiceCredential[]; notes?: string[]; target?: DockerTarget; auditAction?: "install" | "start" | "update" },
) {
	validateTemplate(tmpl);
	const target: DockerTarget = notice?.target ?? { kind: "local" };
	const containerName = safeContainerName(tmpl.slug);
	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const installId = randomUUID();
	const mounts: string[] = [];
	const args = [
		"run",
		"-d",
		"--name",
		containerName,
		"--label",
		"com.vcontrolhub.quick-service=true",
		"--label", `${INSTANCE_LABEL}=${serviceId}`,
		"--label", `${INSTALL_LABEL}=${installId}`,
		"--restart",
		"unless-stopped",
		"--add-host=host.docker.internal:host-gateway",
		"-p",
		`${hostPort}:${internalPort}`,
	];
	for (const ep of tmpl.extraPorts ?? []) args.push("-p", `${ep.host}:${ep.container}`);
	// Remote nodes only get non-socket volume mounts as-is; host mkdir is skipped for remote.
	for (const vol of tmpl.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "Host mount");
		if (target.kind === "remote" && host === DOCKER_SOCKET) {
			// Avoid binding control-plane docker socket semantics onto remote hosts by default.
			continue;
		}
		if (target.kind === "local" && host === DOCKER_SOCKET) {
			// Templates declare the POSIX socket literal; Docker Desktop on
			// Windows needs the host side as the named pipe instead.
			args.push("-v", `${hubHostDockerSocketMount()}:${splitContainerPathAndOptions(vol.container)}`);
			continue;
		}
		if (!TRUSTED_HOST_MOUNTS.has(host)) mounts.push(host);
		args.push("-v", `${host}:${splitContainerPathAndOptions(vol.container)}`);
	}
	for (const [key, value] of Object.entries(tmpl.envJson)) {
		args.push("-e", `${key}=${value}`);
	}
	args.push(tmpl.image, ...parseCommandArgs(tmpl.command));

	await verifyDockerMounts(target, mounts);
	const backupName = `${containerName}__prev_${installId}`;
	const previous = await ownedContainer(target, containerName, serviceId, { storedId: notice?.previousId });
	if (previous) {
		try {
			await dockerExec(target, ["rename", previous, backupName], 15_000);
		} catch (error) {
			// Without the renamed copy there is nothing to roll back to. The
			// current container is untouched; stop instead of deleting it.
			throw new BusinessError(t("backend.quick-service.renameForRollbackFailed", { message: dockerErrorMessage(error) }));
		}
		{
			try {
				// Renaming does not release published ports. Stop the preserved
				// container before starting its replacement, then restart it only
				// if the new container fails and rollback is required.
				await dockerExec(target, ["stop", previous], 30_000);
			} catch (error) {
				try {
					await dockerExec(target, ["rename", previous, containerName], 15_000);
					await dockerExec(target, ["start", previous], 30_000);
				} catch {
					// Surface the original stop failure; recovery is best effort.
				}
				throw error;
			}
		}
	}

	let containerId = "";
	let health: string;
	try {
		const { stdout } = await dockerRun(target, args, 300_000);
		containerId = stdout.trim();
		if (!/^[a-f0-9]{64}$/.test(containerId)) throw new BusinessError(t("backend.quickService.targetMismatch"));
		await applyPostInstallSetup(target, tmpl, containerId);
		// `docker run -d` succeeds once the container exists. Accept the new
		// container only if it is actually up (and healthy when it has a
		// healthcheck); otherwise fall through to the rollback below while the
		// previous container still exists.
		health = await assertContainerStarted(target, containerId);
	} catch (err) {
		const cleanupNotes: string[] = [];
		try {
			const partial = await ownedContainer(target, containerName, serviceId, { installId });
			if (partial) await dockerExec(target, ["rm", "-f", partial], 15_000);
		} catch (cleanupErr) {
			cleanupNotes.push(t("backend.quick-service.cleanupLeftoverFailed", { message: dockerErrorMessage(cleanupErr) }));
		}
		if (previous) {
			try {
				await dockerExec(target, ["rename", previous, containerName], 15_000);
				try {
					await dockerExec(target, ["start", previous], 30_000);
				} catch (startErr) {
					cleanupNotes.push(t("backend.quick-service.previousRestoredNotStarted", { message: dockerErrorMessage(startErr) }));
				}
			} catch (restoreErr) {
				cleanupNotes.push(t("backend.quick-service.previousKeptAsBackup", { name: backupName, message: dockerErrorMessage(restoreErr) }));
			}
		}
		if (cleanupNotes.length === 0) throw err;
		throw new BusinessError(t("backend.quick-service.failureWithCleanupNotes", { message: dockerErrorMessage(err), notes: cleanupNotes.join("; ") }));
	}

	if (previous) {
		try {
			await dockerExec(target, ["rm", "-f", previous], 15_000);
		} catch {
			// ignore leftover backup
		}
	}

	// The new container runs and the previous one is gone: from here a
	// database failure must not be "undone" by restoring the old row (it
	// would describe a container that no longer exists). Retry once, then
	// tell the caller the container is committed.
	const where = {
		id: serviceId, slug: tmpl.slug, instanceKey: instanceKeyForTarget(target),
		serverId: target.kind === "local" ? null : target.serverId,
		...(target.kind === "remote" && target.expectedTeamId !== undefined ? { server: { teamId: target.expectedTeamId, ...target.endpoint } } : {}),
	};
	let saved;
	try {
		saved = await prisma.quickService.update({ where, data: { status: "running", containerId, error: null } })
			.catch(async () => {
				await new Promise((resolve) => setTimeout(resolve, 500));
				return prisma.quickService.update({ where, data: { status: "running", containerId, error: null } });
			});
	} catch (error) {
		// The pre-recreate status already makes this row eligible for recovery
		// if the database remains offline through this last write.
		await prisma.quickService.update({ where, data: { status: "installing", containerId } }).catch(() => undefined);
		throw new ContainerCommittedError(containerId, error);
	}
	await writeQuickServiceAudit({
		target,
		userId: notice?.userId,
		action: notice?.auditAction ?? "install",
		slug: tmpl.slug,
		status: "succeeded",
		detail: { image: tmpl.image, port: hostPort, containerId, health },
		diff: {
			after: { status: "running", port: hostPort, containerId, image: tmpl.image },
		},
	});
	await notifyQuickServiceInstallSuccess(notice?.userId, tmpl, hostPort, notice?.credentials ?? [], notice?.notes ?? [], target);
	return saved;
}

async function applyPostInstallSetup(target: DockerTarget, tmpl: ServiceTemplate, containerName: string) {
	if (tmpl.slug === "alist" && tmpl.initialPassword) {
		await dockerExec(
			target,
			["exec", containerName, "/opt/alist/alist", "admin", "set", tmpl.initialPassword, "--data", "/opt/alist/data"],
			30_000,
		);
	}
}

async function notifyQuickServiceInstallSuccess(userId: string | undefined, tmpl: ServiceTemplate, hostPort: number, credentials: QuickServiceCredential[], notes: string[], target: DockerTarget) {
	if (!userId) return;
	try {
		const remoteHost = target.kind === "remote"
			? (await prisma.server.findUnique({ where: { id: target.serverId, teamId: target.expectedTeamId, ...target.endpoint }, select: { host: true } }))?.host
			: null;
		if (target.kind === "remote" && !remoteHost) return;
		const notice = buildInstallNotice(tmpl, hostPort, credentials, notes, remoteHost ? { host: remoteHost, protocol: "http:" } : undefined);
		await createNotification({
			userId,
			teamId: target.kind === "remote" ? target.expectedTeamId : null,
			type: "system",
			notice: { code: "quickServiceInstalled", params: { name: tmpl.name } },
			message: formatInstallNoticeMessage(tmpl.name, notice),
			// The access URL is an external http://host:port link; the notification
			// action guard (getSafeNotificationActionUrl) rejects off-origin URLs, so
			// linking it here would dead-end at /notifications. The URL is already
			// shown as text in the message body — click-through goes to the internal
			// service list instead.
			actionUrl: "/quick-services",
		});
	} catch {
		// Notification delivery should never flip a successfully started container into a failed install.
	}
}

async function notifyQuickServiceInstallFailure(userId: string | undefined, tmpl: ServiceTemplate, message: string, target?: DockerTarget) {
	if (!userId) return;
	try {
		await createNotification({
			userId,
			teamId: target?.kind === "remote" ? target.expectedTeamId : null,
			type: "system",
			notice: { code: "quickServiceInstallFailed", params: { name: tmpl.name, error: message } },
			actionUrl: "/quick-services",
		});
	} catch {
		// Preserve the original install error even if notification persistence is unavailable.
	}
}
