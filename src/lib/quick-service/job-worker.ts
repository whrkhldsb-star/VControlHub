import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { enqueueJob, claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
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
const QUICK_SERVICE_WORKER_LEASE_MS = 10 * 60 * 1000;
const QUICK_SERVICE_WORKER_ID = `${process.env.HOSTNAME || "vcontrolhub"}:quick-service:${process.pid}`;

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
	if (typeof value !== "string" || !value.trim()) throw new Error(`QuickService 任务缺少 ${label}`);
	return value.trim();
}

function parseTemplate(value: unknown): ServiceTemplate {
	if (!isRecord(value)) throw new Error("QuickService 安装任务缺少模板");
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
	if (!isRecord(payload)) throw new Error("QuickService 任务 payload 无效");
	const action = parseString(payload.action, "操作");
	const slug = parseString(payload.slug, "服务标识");

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

	throw new Error(`不支持的 QuickService 操作：${action}`);
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
	if (activeJob) return { job: activeJob, taskId: `job:${activeJob.id}`, reused: true };

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
	await updateQuickServiceJobProgress(job.id, `准备执行 QuickService ${payload.action}: ${payload.slug}`);

	if (payload.action === "install") {
		await updateQuickServiceJobProgress(job.id, `正在安装 ${payload.slug}：拉取镜像并创建容器`);
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
				`安装完成：${payload.slug}`,
				`宿主机端口：${service.port ?? payload.customPort ?? payload.template.defaultPort}`,
				service.containerId ? `容器：${service.containerId}` : null,
			]),
		});
		return;
	}

	if (payload.action === "start") {
		await updateQuickServiceJobProgress(job.id, `正在启动 ${payload.slug}：启动或重建容器`);
		await startService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status: "running",
			logPreview: quickServiceLogPreview([`启动完成：${payload.slug}`, "状态：running"]),
		});
		return;
	}

	if (payload.action === "stop") {
		await updateQuickServiceJobProgress(job.id, `正在停止 ${payload.slug}：停止 Docker 容器`);
		await stopService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status: "stopped",
			logPreview: quickServiceLogPreview([`停止完成：${payload.slug}`, "状态：stopped"]),
		});
		return;
	}

	if (payload.action === "sync") {
		await updateQuickServiceJobProgress(job.id, `正在刷新 ${payload.slug}：读取 Docker 容器状态`);
		const status = await syncServiceStatus(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			status,
			logPreview: quickServiceLogPreview([`状态刷新完成：${payload.slug}`, `状态：${status}`]),
		});
		return;
	}

	if (payload.action === "update") {
		await updateQuickServiceJobProgress(job.id, `正在更新 ${payload.slug}：拉取镜像并重建容器`);
		const result = await updateService(payload.slug);
		await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
			action: payload.action,
			slug: payload.slug,
			...result,
			logPreview: quickServiceLogPreview([
				`更新完成：${payload.slug}`,
				result.health ? `健康状态：${result.health}` : null,
				result.logTail,
			]),
		});
		return;
	}

	const options: UninstallServiceOptions = { deleteVolumes: payload.deleteVolumes === true };
	await updateQuickServiceJobProgress(job.id, options.deleteVolumes ? `正在卸载 ${payload.slug}：删除容器并清理数据目录` : `正在卸载 ${payload.slug}：删除容器并保留数据目录`);
	await uninstallService(payload.slug, options);
	await completeJob(job.id, QUICK_SERVICE_WORKER_ID, {
		action: payload.action,
		slug: payload.slug,
		deleteVolumes: options.deleteVolumes === true,
		logPreview: quickServiceLogPreview([`卸载完成：${payload.slug}`, options.deleteVolumes ? "已清理可安全删除的数据目录" : "已保留数据目录"]),
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
