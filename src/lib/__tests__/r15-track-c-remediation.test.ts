import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@prisma/client";

const {
	prismaMock,
	lockForTransactionMock,
	tryAcquireAdvisoryLockMock,
	escalateBreachedTicketsMock,
	deliverQueuedEventMock,
} = vi.hoisted(() => ({
	prismaMock: {
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
		$executeRaw: vi.fn(),
		job: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			findFirst: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
			updateManyAndReturn: vi.fn(),
		},
		jobEvent: {
			create: vi.fn(),
			createMany: vi.fn(),
		},
		setting: {
			findMany: vi.fn(),
			upsert: vi.fn(),
		},
		backupSchedule: {
			findMany: vi.fn(),
		},
	},
	lockForTransactionMock: vi.fn(),
	tryAcquireAdvisoryLockMock: vi.fn(),
	escalateBreachedTicketsMock: vi.fn(),
	deliverQueuedEventMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: prismaMock,
}));

vi.mock("@/lib/concurrency/advisory-lock", async () => {
	const actual = await vi.importActual<typeof import("@/lib/concurrency/advisory-lock")>("@/lib/concurrency/advisory-lock");
	return {
		...actual,
		lockForTransaction: lockForTransactionMock,
		tryAcquireAdvisoryLock: tryAcquireAdvisoryLockMock,
	};
});

vi.mock("@/lib/ticket/sla", () => ({
	escalateBreachedTickets: escalateBreachedTicketsMock,
}));

vi.mock("@/lib/itsm/service-outbound", () => ({
	deliverQueuedEvent: deliverQueuedEventMock,
}));

vi.mock("@/lib/itsm/outbox", () => ({
	ITSM_OUTBOUND_JOB_TYPE: "itsm.outbound",
	adoptLegacyTicketJobs: vi.fn(),
	readTicketSnapshot: vi.fn(),
}));

import { scopedPlaybooks } from "@/lib/system/import-executors-automation";
import { importPlaybooksSchema } from "@/lib/system/config-schema";
import { executeImport } from "@/lib/system/import-executors";
import { scrubQuickServiceJobPayloadSecrets } from "@/lib/quick-service/payload-scrub";
import { cancelJob, failJobTerminal } from "@/lib/job/service-lifecycle";
import { recoverStaleRunningJobs } from "@/lib/job/service-maintenance";
import { executeScanAction } from "@/lib/ai/ops/action-executor";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";

describe("Round 15 Track C remediations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.jobEvent.create.mockResolvedValue({ id: "evt-1" });
		prismaMock.jobEvent.createMany.mockResolvedValue({ count: 0 });
		lockForTransactionMock.mockResolvedValue(undefined);
		tryAcquireAdvisoryLockMock.mockResolvedValue(async () => undefined);
	});

	describe("C-01: scopedPlaybooks strict null-team server boundary", () => {
		it("rejects a null-team playbook targeting customer-owned servers while allowing matching scopes", () => {
			const servers = new Map<string, { teamId: string | null }>([
				["srv-cust-a", { teamId: "team-a" }],
				["srv-null", { teamId: null }],
			]);
			const users = new Map<string, { teamId: string | null; isAdmin: boolean }>([
				["admin-1", { teamId: null, isAdmin: true }],
				["user-a", { teamId: "team-a", isAdmin: false }],
			]);
			const makePlaybook = (id: string, teamId: string | null, serverIds: string[]) => ({
				id,
				name: id,
				description: null,
				triggerType: "cron" as const,
				triggerConfig: { type: "cron" as const, expression: "0 * * * *" },
				steps: [{ id: "s1", name: "Run uptime", type: "run_command" as const, retry: 0, timeoutSec: 30, config: { command: "uptime", serverIds } }],
				chainRetry: 0,
				enabled: true,
				createdById: "admin-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				teamId,
			});

			const kept = scopedPlaybooks(
				importPlaybooksSchema.parse([
					makePlaybook("pb-null-to-customer", null, ["srv-cust-a"]),
					makePlaybook("pb-null-to-null", null, ["srv-null"]),
					makePlaybook("pb-team-a-to-team-a", "team-a", ["srv-cust-a"]),
					makePlaybook("pb-team-a-to-null", "team-a", ["srv-null"]),
				]),
				servers,
				users,
			);

			expect(kept.map((p) => p.id)).toEqual(["pb-null-to-null", "pb-team-a-to-team-a"]);
		});
	});

	describe("C-02: QuickService secret scrubbing on cancelJob and lease-expiry reap", () => {
		const secretPayload = {
			action: "install",
			slug: "memos",
			installNoticeCredentials: [{ label: "Admin", value: "super-secret" }],
			template: {
				initialPassword: "pw-123",
				envJson: { DB_PASSWORD: "db-secret", PUBLIC_PORT: "8080" },
			},
		};

		it("scrubs plaintext secrets atomically inside a transaction when a QuickService job is cancelled via cancelJob", async () => {
			prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock));
			prismaMock.job.updateMany.mockResolvedValue({ count: 1 });
			prismaMock.job.findUnique.mockResolvedValue({
				type: "quick_service.lifecycle",
				status: JobStatus.CANCELLED,
				payload: secretPayload,
			});

			await cancelJob("job-qs-1", { userId: "u1", roles: ["admin"], currentTeamId: null });

			expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
			expect(prismaMock.job.updateMany).toHaveBeenCalledTimes(2);
			const scrubCall = prismaMock.job.updateMany.mock.calls[1]![0];
			expect(scrubCall.where).toEqual({
				id: "job-qs-1",
				status: { in: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED] },
			});
			const writtenPayload = scrubCall.data.payload as Record<string, unknown>;
			expect(writtenPayload).not.toHaveProperty("installNoticeCredentials");
			const tpl = writtenPayload.template as Record<string, unknown>;
			expect(tpl.initialPassword).toBe("[redacted]");
			expect((tpl.envJson as Record<string, unknown>).DB_PASSWORD).toBe("[redacted]");
			expect((tpl.envJson as Record<string, unknown>).PUBLIC_PORT).toBe("8080");
		});

		it("scrubs plaintext secrets inside the same transaction when recoverStaleRunningJobs marks an exhausted QuickService job FAILED", async () => {
			prismaMock.job.updateManyAndReturn.mockResolvedValueOnce([]);
			const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
			const txFindUnique = vi.fn().mockResolvedValue({
				type: "quick_service.lifecycle",
				status: JobStatus.FAILED,
				payload: secretPayload,
			});
			prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => {
				const tx = {
					...prismaMock,
					job: {
						...prismaMock.job,
						fields: { maxAttempts: "maxAttempts" },
						findUnique: txFindUnique,
						updateMany: txUpdateMany,
						updateManyAndReturn: vi.fn().mockResolvedValue([
							{ id: "job-qs-expired", type: "quick_service.lifecycle", title: "Install", attempts: 1, maxAttempts: 1, payload: secretPayload },
						]),
					},
				};
				return cb(tx as unknown as typeof prismaMock);
			});
			(prismaMock.job as Record<string, unknown>).fields = { maxAttempts: "maxAttempts" };

			const result = await recoverStaleRunningJobs({ staleBefore: new Date() });
			expect(result.failed).toEqual(["job-qs-expired"]);
			expect(txFindUnique).toHaveBeenCalledTimes(1);
			expect(txUpdateMany).toHaveBeenCalledTimes(1);
			const writtenPayload = txUpdateMany.mock.calls[0]![0].data.payload as Record<string, unknown>;
			expect(writtenPayload).not.toHaveProperty("installNoticeCredentials");
		});

		it("does not scrub while a QuickService job is RUNNING or PENDING (preserving retry credentials)", async () => {
			for (const status of [JobStatus.RUNNING, JobStatus.PENDING]) {
				prismaMock.job.findUnique.mockResolvedValueOnce({
					type: "quick_service.lifecycle",
					status,
					payload: secretPayload,
				});
				const changed = await scrubQuickServiceJobPayloadSecrets("job-non-terminal");
				expect(changed).toBe(false);
			}
			expect(prismaMock.job.updateMany).not.toHaveBeenCalled();
		});
	});

	describe("C-05: executeScanAction advisory lock ordering without LOCK TABLE settings", () => {
		it("acquires ai-ops-settings advisory lock BEFORE job FOR UPDATE and never locks the settings table", async () => {
			const order: string[] = [];
			lockForTransactionMock.mockImplementation(async (_tx: unknown, ns: string, key: string) => {
				order.push(`advisory:${ns}:${key}`);
			});
			const tx = {
				$queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
					const sql = strings.join(" ");
					if (sql.includes("FROM jobs")) {
						order.push("lock:jobs");
						return [{ id: "job-1" }];
					}
					if (sql.includes("FROM ai_providers")) {
						order.push("lock:ai_providers");
						return [{ id: "prov-1" }];
					}
					return [];
				}),
				$executeRaw: vi.fn().mockImplementation(async () => {
					order.push("executeRaw");
					return 0;
				}),
				job: {
					findUniqueOrThrow: vi.fn().mockResolvedValue({ payload: {} }),
					update: vi.fn().mockResolvedValue({ id: "job-1" }),
				},
				setting: {
					findMany: vi.fn().mockResolvedValue([
						{ key: "ai.ops.mode", value: "recommendation" },
					]),
				},
			};
			prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));

			const ac = new AbortController();
			const res = await executeScanAction(
				"job-1",
				"worker-1",
				1,
				{ id: "act-1", action: "alert.evaluate", risk: "low" },
				ac.signal,
				{ providerId: "", binding: "" },
			);

			expect(res.executed).toBe(false);
			expect(order[0]).toBe("advisory:ai-ops-settings:global");
			expect(order[1]).toBe("lock:jobs");
			expect(tx.$executeRaw).not.toHaveBeenCalled();
		});
	});

	describe("C-06: executeImport handles malformed input safely without throwing TypeError", () => {
		it("returns a rolled-back structured error when file.tables is missing", async () => {
			const res = await executeImport(
				{ version: 999 } as unknown as Parameters<typeof executeImport>[0],
				{ dryRun: false, overwriteExisting: false, importUsers: false, importSettings: false },
			);
			expect(res.rolledBack).toBe(true);
			expect(res.skipped).toBe(0);
			expect(res.errors).toEqual(["IMPORT_FAILED.validation"]);
		});
	});

	describe("C-07: failJobTerminal persists options.result onto Job.result", () => {
		it("writes result into Job.updateMany data atomically inside a transaction when provided", async () => {
			prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock));
			prismaMock.job.updateMany.mockResolvedValue({ count: 1 });
			prismaMock.job.findUnique.mockResolvedValue({ type: "command.execute", status: JobStatus.FAILED, payload: {} });
			await failJobTerminal("job-term-1", "worker-1", "terminal boom", {
				attempts: 1,
				result: { commandRequestId: "cmd-1", status: "FAILED" },
			});
			expect(prismaMock.job.updateMany).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: JobStatus.FAILED,
						result: { commandRequestId: "cmd-1", status: "FAILED" },
					}),
				}),
			);
		});
	});

	describe("C-04: Repo-wide durable worker lease-fencing invariants", () => {
		it("every hardened durable worker handles LeaseLostError and forwards attempts", () => {
			const workers = [
				"src/lib/backup/job-worker.ts",
				"src/lib/backup/schedule-worker.ts",
				"src/lib/ticket/sla-worker.ts",
				"src/lib/itsm/outbound-worker.ts",
				"src/lib/cost/snapshot-worker.ts",
				"src/lib/command/execution-worker.ts",
			];
			for (const rel of workers) {
				const content = readFileSync(path.resolve(process.cwd(), rel), "utf8");
				expect(content, `${rel} must handle LeaseLostError`).toContain("LeaseLostError");
				expect(content, `${rel} must pass attempts: job.attempts`).toContain("attempts: job.attempts");
				expect(content, `${rel} must gate on initial heartbeat lease count`).toMatch(/if\s*\(\s*(?:!(?:initial)?[lL]ease\.count|lease\s*&&\s*lease\.count\s*===\s*0)\s*\)/);
			}
		});

		it("verifies LeaseLostError class identity", () => {
			const err = new LeaseLostError("job-x");
			expect(err).toBeInstanceOf(LeaseLostError);
			expect(err.name).toBe("LeaseLostError");
		});
	});

	describe("C-03: AI chat orchestrator revalidates session inside lock and before SSE send", () => {
		it("rechecks currentHostedSession inside withChatGeneration before persisting aiMessage and again post-commit before SSE send", () => {
			const content = readFileSync(
				path.resolve(process.cwd(), "src/lib/ai/chat-orchestrator.ts"),
				"utf8",
			);
			const execIdx = content.indexOf("await executeSafeAction(");
			const lockIdx = content.indexOf("await withChatGeneration(input.conversationId, input.userMessageId", execIdx);
			const inLockRecheckIdx = content.indexOf("await currentHostedSession(input);", lockIdx);
			const persistIdx = content.indexOf("content: JSON.stringify(execution)", inLockRecheckIdx);
			const postCommitRecheckIdx = content.indexOf("await currentHostedSession(input);", persistIdx);
			const sendIdx = content.indexOf('type: "tool_result"', postCommitRecheckIdx);
			expect(execIdx).toBeGreaterThan(-1);
			expect(lockIdx).toBeGreaterThan(execIdx);
			expect(inLockRecheckIdx).toBeGreaterThan(lockIdx);
			expect(persistIdx).toBeGreaterThan(inLockRecheckIdx);
			expect(postCommitRecheckIdx).toBeGreaterThan(persistIdx);
			expect(sendIdx).toBeGreaterThan(postCommitRecheckIdx);
			expect(content).toContain("redacted: true");
		});
	});
});
