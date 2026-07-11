import { JobStatus, Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import { enqueueJob, claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { ConflictError } from "@/lib/errors";
import type { QuickServiceCredential } from "@/lib/quick-service/install-notice";
import type { ServiceTemplate } from "@/lib/quick-service/types";
import {
	installService,
	startService,
	stopService,
	syncServiceStatus,
	uninstallService,
	updateService,
	type UninstallServiceOptions,
} from "./service";

const logger = createLogger("quick-service-job-worker");

export const QUICK_SERVICE_JOB_TYPE = "quick_service.lifecycle";
const QUICK_SERVICE_WORKER_INTERVAL_MS = 5_000;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= QUICK_SERVICE_WORKER_LEASE_MS 等同原值)。
const QUICK_SERVICE_WORKER_LEASE_MS = computeLeaseMs("quick-service");
const QUICK_SERVICE_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:quick-service:${process.pid}`;

type QuickServiceInstallJobPayload = {
	action: "install";
	slug: string;
	template: ServiceTemplate;
	customPort?: number;
	installNoticeCredentials?: QuickServiceCredential[];
	installNoticeNotes?: string[];
};

type QuickServiceExistingJobPayload = {
	action: "start" | "stop" | "sync" | "update" | "uninstall";
	slug: string;
	deleteVolumes?: boolean;
};

export type QuickServiceJobPayload = QuickServiceInstallJobPayload | QuickServiceExistingJobPayload;

type QuickServiceWorkerState = {
	started: boolean;
	running: boolean;
	timer: NodeJS.Timeout | null;
};

type QuickServiceWorkerGlobal = typeof globalThis & {
	__vcontrolhubQuickServiceWorker?: QuickServiceWorkerState;
};

function getWorkerState() {
	const globalState = globalThis as QuickServiceWorkerGlobal;
	globalState.__vcontrolhubQuickServiceWorker ??= {
		started: false,
		running: false,
		timer: null,
	};
	return globalState.__vcontrolhubQuickServiceWorker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseString(value: unknown, label: string) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`QuickService task missing ${label}`);
	return value.trim();
}

function parseTemplate(value: unknown): ServiceTemplate {
	if (!isRecord(value)) throw new Error("QuickService install task missing template");
	return value as unknown as ServiceTemplate;
}

function parseCredentials(value: unknown): QuickServiceCredential[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is QuickServiceCredential => isRecord(item) && typeof item.label === "string" && typeof item.value === "string");
}

function parseNotes(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is string => typeof item === "string");
}

export function parseQuickServiceJobPayload(payload: Prisma.JsonValue): QuickServiceJobPayload {
	if (!isRecord(payload)) throw new Error("QuickService task payload invalid");
	const action = parseString(payload.action, "action");
	const slug = parseString(payload.slug, "service identifier");

	if (action === "install") {
		const customPort = typeof payload.customPort === "number" && Number.isInteger(payload.customPort) ? payload.customPort : undefined;
		return {
			action,
			slug,
			template: parseTemplate(payload.template),
			customPort,
			installNoticeCredentials: parseCredentials(payload.installNoticeCredentials),
			installNoticeNotes: parseNotes(payload.installNoticeNotes),
		};
	}

	if (action === "start" || action === "stop" || action === "sync" || action === "update" || action === "uninstall") {
		return {
			action,
			slug,
			deleteVolumes: typeof payload.deleteVolumes === "boolean" ? payload.deleteVolumes : undefined,
		};
	}

	throw new Error(`Unsupported QuickService action: ${action}`);
}

async function findActiveQuickServiceJob(slug: string) {
	return prisma.job.findFirst({
		where: {
			type: QUICK_SERVICE_JOB_TYPE,
			status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
			payload: { path: ["slug"], equals: slug },
		},
		orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
	});
}

export async function enqueueQuickServiceJob(input: {
	title: string;
	payload: QuickServiceJobPayload;
	createdBy?: string | null;
	priority?: number;
}) {
	const activeJob = await findActiveQuickServiceJob(input.payload.slug);
	if (activeJob) {
		const activePayload = parseQuickServiceJobPayload(activeJob.payload);
		const sameOperation = activePayload.action === input.payload.action
			&& (activePayload.action !== "uninstall"
				|| input.payload.action !== "uninstall"
				|| Boolean(activePayload.deleteVolumes) === Boolean(input.payload.deleteVolumes));
		if (sameOperation) return { job: activeJob, taskId: `job:${activeJob.id}`, reused: true };
		throw new ConflictError(`Service ${input.payload.slug} already has a different lifecycle task in progress`);
	}

	const job = await enqueueJob({
		type: QUICK_SERVICE_JOB_TYPE,
		title: input.title,
		payload: input.payload as unknown as Prisma.InputJsonValue,
		createdBy: input.createdBy ?? null,
		priority: input.priority ?? 10,
		maxAttempts: 1,
	});
	return { job, taskId: `job:${job.id}`, reused: false };
}

async function updateQuickServiceJobProgress(jobId: string, progress: string) {
	await heartbeatJob(jobId, QUICK_SERVICE_WORKER_ID, {
		leaseMs: QUICK_SERVICE_WORKER_LEASE_MS,
		progress,
	});
}

function quickServiceLogPreview(lines: Array<string | null | undefined>) {
	return lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0).join("\n");
}

async function executeQuickServiceJob(job: { id: string; payload: Prisma.JsonValue }) {
	const payload = parseQuickServiceJobPayload(job.payload);
	await updateQuickServiceJobProgress(job.id, `Preparing to execute QuickService ${payload.action}: ${payload.slug}`);

	if (payload.action === "install") {
		await updateQuickServiceJobProgress(job.id, `Installing ${payload.slug}: pulling image and creating container`);
		const service = await installService({
			template: payload.template,
			customPort: payload.customPort,
			installNoticeCredentials: payload.installNoticeCredentials,
			installNoticeNotes: payload.installNoticeNotes,
		});
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			serviceId: service.id,
			status: service.status,
			logPreview: quickServiceLogPreview([
				`Installation complete: ${payload.slug}`,
				`Host port: ${service.port ?? payload.customPort ?? payload.template.defaultPort}`,
				service.containerId ? `Container: ${service.containerId}` : null,
			]),
		});
		return;
	}

	if (payload.action === "start") {
		await updateQuickServiceJobProgress(job.id, `Starting ${payload.slug}: starting or recreating container`);
		await startService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status: "running",
			logPreview: quickServiceLogPreview([`Start complete: ${payload.slug}`, "Status: running"]),
		});
		return;
	}

	if (payload.action === "stop") {
		await updateQuickServiceJobProgress(job.id, `Stopping ${payload.slug}: stopping Docker container`);
		await stopService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status: "stopped",
			logPreview: quickServiceLogPreview([`Stop complete: ${payload.slug}`, "Status: stopped"]),
		});
		return;
	}

	if (payload.action === "sync") {
		await updateQuickServiceJobProgress(job.id, `Refreshing ${payload.slug}: reading Docker container status`);
		const status = await syncServiceStatus(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status,
			logPreview: quickServiceLogPreview([`Status refresh complete: ${payload.slug}`, `Status: ${status}`]),
		});
		return;
	}

	if (payload.action === "update") {
		await updateQuickServiceJobProgress(job.id, `Updating ${payload.slug}: pulling image and recreating container`);
		const result = await updateService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			...result,
			logPreview: quickServiceLogPreview([
				`Update complete: ${payload.slug}`,
				result.health ? `Health status: ${result.health}` : null,
				result.logTail,
			]),
		});
		return;
	}

	const options: UninstallServiceOptions = { deleteVolumes: payload.deleteVolumes === true };
	await updateQuickServiceJobProgress(job.id, options.deleteVolumes ? `Uninstalling ${payload.slug}: removing container and cleaning data directory` : `Uninstalling ${payload.slug}: removing container and keeping data directory`);
	await uninstallService(payload.slug, options);
	await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
		action: payload.action,
		slug: payload.slug,
		deleteVolumes: options.deleteVolumes === true,
		logPreview: quickServiceLogPreview([`Uninstall complete: ${payload.slug}`, options.deleteVolumes ? "Cleaned safely deletable data directories" : "Kept data directory"]),
	});
}

export async function runQuickServiceJobWorkerOnce(state = getWorkerState(), reason = "manual") {
	if (state.running) {
		logger.warn("Skipping QuickService job tick because a previous tick is still running", { reason });
		return false;
	}

	state.running = true;
	try {
		const job = await claimNextJob({
			workerId: QUICK_SERVICE_WORKER_ID,
			types: [QUICK_SERVICE_JOB_TYPE],
			leaseMs: QUICK_SERVICE_WORKER_LEASE_MS,
		});
		if (!job) return false;

		try {
			await executeQuickServiceJob(job);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("QuickService job failed", { reason, jobId: job.id, error: message });
			await failJob(job.id, QUICK_SERVICE_WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
		}
		return true;
	} catch (error) {
		logger.error("QuickService job tick failed", {
			reason,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	} finally {
		state.running = false;
	}
}

export async function startQuickServiceJobWorker() {
	const state = getWorkerState();
	if (state.started) return state;

	state.started = true;
	void runQuickServiceJobWorkerOnce(state, "startup");
	state.timer = setInterval(() => {
		void runQuickServiceJobWorkerOnce(state, "interval");
	}, QUICK_SERVICE_WORKER_INTERVAL_MS);
	state.timer.unref?.();

	logger.info("QuickService job worker started", { intervalMs: QUICK_SERVICE_WORKER_INTERVAL_MS, workerId: QUICK_SERVICE_WORKER_ID });
	return state;
}

export function stopQuickServiceJobWorkerForTests() {
	const state = getWorkerState();
	if (state.timer) clearInterval(state.timer);
	state.started = false;
	state.running = false;
	state.timer = null;
}
