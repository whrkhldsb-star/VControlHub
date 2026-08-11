/**
 * Install/start-container helpers for quick services.
 *
 * Split out from `service-lifecycle.ts` so the public lifecycle facade can
 * stay small while the install rollback/audit/notification path remains
 * isolated and testable.
 */
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { createNotification } from "@/lib/notification/service";
import { t } from "@/lib/i18n/service-translations";
import { buildInstallNotice, formatInstallNoticeMessage, type QuickServiceCredential } from "./install-notice";
import {
	dockerErrorMessage,
	dockerExec,
	dockerRun,
	getDockerEnvironmentStatusFor,
	instanceKeyForTarget,
	isRemotePortAvailable,
	type DockerTarget,
} from "./docker-cli";
import {
	allocatePort,
	assertTemplatePortsAvailable,
	captureQuickServiceSnapshot,
	parseCommandArgs,
	releasePortReservations,
	resolveEnvValue,
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
import { createLogger } from "@/lib/logging";

const qsLogger = createLogger("quick-service-lifecycle");

const { normalizeVolumeEndpoint, splitContainerPathAndOptions, mkdirSync, DOCKER_SOCKET, TRUSTED_HOST_MOUNTS } = __internals;

async function rollbackInstallToSnapshot(
	slug: string,
	before: QuickServiceSnapshot | null,
	error: string,
	instanceKey: string = "hub-host",
) {
	const where = { instanceKey_slug: { instanceKey, slug } } as const;
	if (!before) {
		try {
			await prisma.quickService.delete({ where });
		} catch {
			// Record no longer exists (concurrent delete) — mark as errored instead.
			await prisma.quickService.update({ where, data: { status: "error", error } }).catch((err) => { qsLogger.warn("quickService status update failed", { error: err instanceof Error ? err.message : String(err) }); });
		}
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

	// Pre-flight: ensure Docker is available on the selected target
	const dockerStatus = await getDockerEnvironmentStatusFor(target);
	if (!dockerStatus.available) {
		throw new BusinessError(`${dockerStatus.message}. ${dockerStatus.installHint}`);
	}

	validateTemplate(template);
	const before = await captureQuickServiceSnapshot(template.slug, instanceKey);
	await writeQuickServiceAudit({
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
	let reservedPorts: number[] = [];
	const hostPort = await withPortAllocationLock(portScope, async () => {
		if (target.kind === "remote") {
			if (customPort) {
				const free = await isRemotePortAvailable(target.serverId, customPort);
				if (!free) {
					throw new BusinessError(
						t("backend.quick-service.portInUseOnTarget", { port: customPort }),
					);
				}
				return customPort;
			}
			const candidates: number[] = [template.defaultPort];
			for (let i = 0; i < 40; i++) {
				candidates.push(10000 + Math.floor(Math.random() * (65535 - 10000 + 1)));
			}
			for (const candidate of candidates) {
				if (await isRemotePortAvailable(target.serverId, candidate)) {
					for (const ep of template.extraPorts ?? []) {
						const free = await isRemotePortAvailable(target.serverId, ep.host);
						if (!free) {
							throw new BusinessError(
								t("backend.quick-service.extraPortInUseOnTarget", {
									port: ep.host,
								}),
							);
						}
					}
					return candidate;
				}
			}
			throw new BusinessError(
				t("backend.quick-service.noAvailablePortOnTarget"),
			);
		}
		const port = customPort ?? allocatePort(template.defaultPort);
		assertTemplatePortsAvailable(template, port);
		reservedPorts = templateReservedPorts(template, port);
		return port;
	});

	if (target.kind === "local") {
		for (const vol of template.volumesJson) {
			const host = normalizeVolumeEndpoint(vol.host, "Host mount");
			if (host !== DOCKER_SOCKET && !TRUSTED_HOST_MOUNTS.has(host)) {
				mkdirSync(host, { recursive: true });
			}
		}
	}

	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const extraPortsStr = JSON.stringify(template.extraPorts ?? []);

	let svc;
	try {
		svc = await prisma.quickService.upsert({
			where: { instanceKey_slug: { instanceKey, slug: template.slug } },
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
				serverId,
				error: null,
			},
			create: {
				slug: template.slug,
				instanceKey,
				serverId,
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
		throw new BusinessError(
			t("backend.quick-service.installFailedWithMessage", { message: msg }),
		);
	}

	try {
		// Drop hub-local reservations immediately before docker -p so the daemon can bind.
		if (reservedPorts.length > 0) releasePortReservations(reservedPorts);
		await recreateDockerContainer(svc.id, template, hostPort, { userId, credentials: installNoticeCredentials, notes: installNoticeNotes, target });
	} catch (err) {
		if (reservedPorts.length > 0) releasePortReservations(reservedPorts);
		let msg = dockerErrorMessage(err);
		try {
			await dockerExec(target, ["rm", "-f", safeContainerName(template.slug)], 15_000);
		} catch (cleanupErr) {
			msg = `${msg}; failed to clean up leftover container: ${dockerErrorMessage(cleanupErr)}`;
		}
		const rollback = await rollbackInstallToSnapshot(template.slug, before, msg.slice(0, 500), instanceKey);
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
		throw new BusinessError(
			t("backend.quick-service.installFailedWithMessage", { message: msg }),
		);
	}

	return { ...svc, port: hostPort };
}

/**
 * Package-internal recreate helper (rename/rm then create). Not re-exported from
 * the public quick-service barrel — use installService / startService / updateService.
 */
export async function recreateDockerContainer(
	serviceId: string,
	tmpl: ServiceTemplate,
	hostPort: number,
	notice?: { userId?: string; credentials?: QuickServiceCredential[]; notes?: string[]; target?: DockerTarget },
) {
	validateTemplate(tmpl);
	const target: DockerTarget = notice?.target ?? { kind: "local" };
	const containerName = safeContainerName(tmpl.slug);
	// Side-by-side recreate: rename existing container so a failed run/post-install can restore it.
	const backupName = `${containerName}__prev`;
	let hadExisting = false;
	try {
		const existingId = (await dockerExec(target, ["inspect", "--format={{.Id}}", containerName], 10_000)).trim();
		hadExisting = existingId.length > 0;
	} catch {
		hadExisting = false;
	}
	if (hadExisting) {
		try {
			await dockerExec(target, ["rm", "-f", backupName], 15_000);
		} catch {
			// no prior backup
		}
		try {
			await dockerExec(target, ["rename", containerName, backupName], 15_000);
		} catch {
			// Rename failed — fall back to destructive remove.
			await dockerExec(target, ["rm", "-f", containerName], 15_000);
			hadExisting = false;
		}
		if (hadExisting) {
			try {
				// Renaming does not release published ports. Stop the preserved
				// container before starting its replacement, then restart it only
				// if the new container fails and rollback is required.
				await dockerExec(target, ["stop", backupName], 30_000);
			} catch (error) {
				try {
					await dockerExec(target, ["rename", backupName, containerName], 15_000);
					await dockerExec(target, ["start", containerName], 30_000);
				} catch {
					// Surface the original stop failure; recovery is best effort.
				}
				throw error;
			}
		}
	}

	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const args = [
		"run",
		"-d",
		"--name",
		containerName,
		"--label",
		"com.vcontrolhub.quick-service=true",
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
		args.push("-v", `${host}:${splitContainerPathAndOptions(vol.container)}`);
	}
	for (const [key, value] of Object.entries(tmpl.envJson)) {
		if (value !== "") args.push("-e", `${key}=${resolveEnvValue(String(value))}`);
	}
	args.push(tmpl.image, ...parseCommandArgs(tmpl.command));

	let containerId: string;
	try {
		const { stdout } = await dockerRun(target, args, 300_000);
		containerId = stdout.trim().substring(0, 12);
		await applyPostInstallSetup(target, tmpl, containerName);
	} catch (err) {
		try {
			await dockerExec(target, ["rm", "-f", containerName], 15_000);
		} catch {
			// ignore partial container
		}
		if (hadExisting) {
			try {
				await dockerExec(target, ["rename", backupName, containerName], 15_000);
				try {
					await dockerExec(target, ["start", containerName], 30_000);
				} catch {
					// leave stopped; caller records error
				}
			} catch {
				// restore failed
			}
		}
		throw err;
	}

	if (hadExisting) {
		try {
			await dockerExec(target, ["rm", "-f", backupName], 15_000);
		} catch {
			// ignore leftover backup
		}
	}

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
	await notifyQuickServiceInstallSuccess(notice?.userId, tmpl, hostPort, notice?.credentials ?? [], notice?.notes ?? [], target);
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
			? (await prisma.server.findUnique({ where: { id: target.serverId }, select: { host: true } }))?.host
			: null;
		const notice = buildInstallNotice(tmpl, hostPort, credentials, notes, remoteHost ? { host: remoteHost, protocol: "http:" } : undefined);
		await createNotification({
			userId,
			type: "system",
			title: `Quick service installed successfully: ${tmpl.name}`,
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
			title: `Quick service installation failed: ${tmpl.name}`,
			message: `${tmpl.name} installation failed: ${message}`,
			actionUrl: "/quick-services",
		});
	} catch {
		// Preserve the original install error even if notification persistence is unavailable.
	}
}
