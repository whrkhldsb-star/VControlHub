import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeQaReportTrends, getQaReportDetail, listQaReports } from "../service";

const REPO_ROOT = process.cwd();

function makeRemediationState(): Record<string, unknown> {
	return {
		updatedAt: "2026-06-11T16:28:00Z",
		successfulRemediationRunsSinceFreshAudit: 10,
		completed: [
			{
				id: "media-image-bed-nav-consolidation",
				completedAt: "2026-06-07T16:22:34.044067+00:00",
				summary:
					"Recovered production after missing .next build artifacts, confirmed systemd enablement and closed media/image-bed navigation gap.",
				evidence: [
					{
						command: "npm run test -- --run src/lib/media/service.test.ts",
						result: "5 files / 21 tests passed",
					},
					{
						command: "./deploy/smoke-test.sh whrkhldsb.qzz.io vcontrolhub",
						result: "25/25 checks passed",
					},
				],
			},
		],
		resolvedBlockers: [
			{
				at: "2026-06-02T10:37:00Z",
				target: "quick-services-docker-canary",
				type: "environment_blocker",
				summary: "Production host had no Docker binary.",
				resolvedAt: "2026-06-03T06:35:45Z",
				resolution: "Deterministic preflight verified Docker is now installed and active.",
				next: "Use a Docker-capable canary host for the next lifecycle run.",
			},
		],
	};
}

function makeQaLoopState(): Record<string, unknown> {
	return {
		updatedAt: "2026-06-08T17:52:20Z",
		runCounter: 61,
		lastRun: {
			id: "backups-create-form-visible-labels",
			title: "Backups create/schedule form visible labels",
			startedAt: "2026-06-08T17:34:25Z",
			finishedAt: "2026-06-08T17:52:20Z",
			status: "completed_verified_deployed",
			summary: "Forms now use visible htmlFor/id labels.",
			evidenceMatrix: {
				browser_or_dom: "Production browser DOM confirmed htmlFor/id wiring.",
				regression: ["npm run verify passed", "smoke 25/25"],
			},
			changeContract: {
				files: ["src/app/backups/create-backup-form.tsx", "src/app/backups/schedule-backup-form.tsx"],
				commit: "abcdef1234567890",
				notes: "Visible labels only.",
			},
		},
	};
}

function makeAutonomousMaintenanceState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = new Date();
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
	return {
		module_queue: [
			"downloads",
			"backups-scheduled-tasks",
			"ai-providers-models",
			"media-images",
		],
		last_module: "downloads",
		completed_runs: [
			{
				timestamp_utc: oneDayAgo.toISOString(),
				module: "downloads",
				result: "deployed_committed_pushed",
				change_size: "small",
				summary: "download cap landed",
				files: ["src/lib/downloads/service.ts"],
				validation: ["npx vitest run", "npm run typecheck"],
				deployment: "systemctl restart succeeded",
				commit: "abc123",
			},
			{
				timestamp_utc: oneDayAgo.toISOString(),
				module: "backups-scheduled-tasks",
				result: "deployed_committed_pushed_after_manual_closeout",
				change_size: "small",
				summary: "backups retention scheduler ran",
				files: ["src/lib/backup/retention.ts"],
				validation: ["npx vitest run"],
				deployment: "systemctl restart succeeded",
				commit: "def456",
			},
			{
				timestamp_utc: twoDaysAgo.toISOString(),
				module: "ai-providers-models",
				result: "deployed_committed_pushed",
				change_size: "small",
				summary: "ai provider config update",
				files: ["src/lib/ai/config.ts"],
				validation: ["npx vitest run"],
				deployment: "systemctl restart succeeded",
				commit: "ghi789",
			},
			{
				timestamp_utc: twoDaysAgo.toISOString(),
				module: "downloads",
				result: "code_reverified_deploy_still_blocked_by_restart_approval",
				change_size: "small",
				summary: "no change vs prior tick",
				files: ["src/lib/downloads/service.ts"],
				validation: ["git diff --check"],
				deployment: "systemctl restart blocked by approval",
				commit: null,
			},
		],
		...overrides,
	};
}

let tempDir: string | null = null;
const realCwd = process.cwd;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-reports-test-"));
	const hermesDir = path.join(tempDir, ".hermes");
	await fs.mkdir(hermesDir, { recursive: true });
	await fs.writeFile(
		path.join(hermesDir, "remediation-state.json"),
		JSON.stringify(makeRemediationState()),
		"utf8",
	);
	await fs.writeFile(path.join(hermesDir, "qa-loop-state.json"), JSON.stringify(makeQaLoopState()), "utf8");
	await fs.writeFile(
		path.join(hermesDir, "autonomous-maintenance-state.json"),
		JSON.stringify(makeAutonomousMaintenanceState()),
		"utf8",
	);
	process.cwd = () => tempDir!;
});

afterEach(async () => {
	process.cwd = realCwd;
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
	vi.restoreAllMocks();
});

describe("qa-reports/service", () => {
	it("listQaReports aggregates slice / blocker / qa_run rows from .hermes/", async () => {
		const result = await listQaReports();
		expect(result.totals).toEqual({ total: 3, slices: 1, blockers: 1, qaRuns: 1 });
		expect(result.reports).toHaveLength(3);
		const kinds = result.reports.map((report) => report.kind).sort();
		expect(kinds).toEqual(["blocker", "qa_run", "slice"]);
		// Newest first
		const first = result.reports[0]!;
		expect(first.finishedAt >= result.reports[1]!.finishedAt).toBe(true);
		expect(result.lastUpdatedAt).toBe("2026-06-11T16:28:00Z");
	});

	it("listQaReports returns empty aggregate when .hermes/ is missing", async () => {
		if (tempDir) {
			await fs.rm(path.join(tempDir, ".hermes"), { recursive: true, force: true });
		}
		const result = await listQaReports();
		expect(result.totals.total).toBe(0);
		expect(result.reports).toEqual([]);
		expect(result.lastUpdatedAt).toBeNull();
	});

	it("listQaReports gracefully handles malformed .hermes JSON", async () => {
		if (tempDir) {
			await fs.writeFile(path.join(tempDir, ".hermes", "remediation-state.json"), "not-json", "utf8");
		}
		const result = await listQaReports();
		expect(result.totals.qaRuns).toBe(1);
		expect(result.totals.slices).toBe(0);
	});

	it("getQaReportDetail returns the matching slice with evidence rows", async () => {
		const detail = await getQaReportDetail("slice:media-image-bed-nav-consolidation");
		expect(detail).not.toBeNull();
		expect(detail?.kind).toBe("slice");
		expect(detail?.sourceId).toBe("media-image-bed-nav-consolidation");
		expect(detail?.evidence).toHaveLength(2);
		expect(detail?.evidence[0]?.command).toContain("npm run test");
	});

	it("getQaReportDetail returns blocker with resolution + next as evidence", async () => {
		const detail = await getQaReportDetail("blocker:quick-services-docker-canary:2026-06-03T06:35:45Z");
		expect(detail).not.toBeNull();
		expect(detail?.kind).toBe("blocker");
		expect(detail?.next).toContain("Docker-capable");
		expect(detail?.evidence.some((row) => row.command === "resolution")).toBe(true);
	});

	it("getQaReportDetail returns qa_run with evidenceMatrix flattened to rows", async () => {
		const detail = await getQaReportDetail("qa_run:backups-create-form-visible-labels");
		expect(detail).not.toBeNull();
		expect(detail?.kind).toBe("qa_run");
		const evidenceCommands = detail?.evidence.map((row) => row.command) ?? [];
		expect(evidenceCommands).toEqual(
			expect.arrayContaining(["browser_or_dom", "regression"]),
		);
		expect(detail?.changeContract?.files).toHaveLength(2);
		expect(detail?.changeContract?.commit).toBe("abcdef1234567890");
	});

	it("getQaReportDetail returns null for unknown ids", async () => {
		expect(await getQaReportDetail("nope")).toBeNull();
		expect(await getQaReportDetail("")).toBeNull();
		expect(await getQaReportDetail("slice:missing-id")).toBeNull();
		expect(await getQaReportDetail("qa_run:missing-run")).toBeNull();
		expect(await getQaReportDetail("blocker:missing-blocker:2026-06-01T00:00:00Z")).toBeNull();
	});

	it("falls back to process.cwd() when no temp dir is provided", async () => {
		process.cwd = realCwd;
		const result = await listQaReports();
		// Repo .hermes/remediation-state.json has at least 1 completed item
		expect(result.totals.total).toBeGreaterThanOrEqual(1);
		expect(REPO_ROOT).toBeTruthy();
	});
});

describe("qa-reports/service.computeQaReportTrends", () => {
	it("returns a populated trends aggregate from autonomous-maintenance-state.json", async () => {
		const trends = await computeQaReportTrends();
		expect(trends.cards).toHaveLength(4);
		const totalRunsCard = trends.cards.find((card) => card.id === "totalRuns");
		expect(totalRunsCard?.value).toBe("4");
		expect(totalRunsCard?.raw).toBe(4);
		const successRateCard = trends.cards.find((card) => card.id === "successRate");
		// 3 of 4 runs start with "deployed_committed_pushed" → 75%
		expect(successRateCard?.value).toBe("75%");
		expect(successRateCard?.raw).toBe(75);
		const moduleCoverageCard = trends.cards.find((card) => card.id === "moduleCoverage");
		expect(moduleCoverageCard?.value).toBe("3/4");
		const lastFailureCard = trends.cards.find((card) => card.id === "lastFailure");
		expect(lastFailureCard?.value).toBe("downloads");
		expect(lastFailureCard?.tone).toBe("warn");
	});

	it("aggregates per-UTC-day success/failure buckets for the last 7 days", async () => {
		const trends = await computeQaReportTrends();
		// We always seed 7 day buckets; only 2 days have runs.
		expect(trends.dailyBuckets).toHaveLength(7);
		const daysWithRuns = trends.dailyBuckets.filter((bucket) => bucket.total > 0);
		// 2 different days each have 2 runs
		expect(daysWithRuns).toHaveLength(2);
		const totals = daysWithRuns.reduce((sum, bucket) => sum + bucket.total, 0);
		expect(totals).toBe(4);
		const successTotals = daysWithRuns.reduce((sum, bucket) => sum + bucket.success, 0);
		expect(successTotals).toBe(3);
	});

	it("lists recent runs newest-first, capped at 5", async () => {
		const trends = await computeQaReportTrends();
		expect(trends.recentRuns.length).toBeGreaterThan(0);
		expect(trends.recentRuns.length).toBeLessThanOrEqual(5);
		// Newest first
		for (let i = 0; i < trends.recentRuns.length - 1; i += 1) {
			const current = trends.recentRuns[i]!.timestamp;
			const next = trends.recentRuns[i + 1]!.timestamp;
			expect(current >= next).toBe(true);
		}
		// isSuccess reflects the deploy_committed_pushed prefix
		const failed = trends.recentRuns.find((run) => !run.isSuccess);
		expect(failed?.result).toMatch(/^code_reverified_deploy_still_blocked_by_restart_approval$/);
	});

	it("ranks module coverage by visit count desc and exposes lastVisitedAt", async () => {
		const trends = await computeQaReportTrends();
		const downloadsRow = trends.moduleCoverage.find((row) => row.module === "downloads");
		expect(downloadsRow?.visitCount).toBe(2);
		expect(downloadsRow?.lastVisitedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		// Queued modules without any run still appear with zero visits
		const mediaRow = trends.moduleCoverage.find((row) => row.module === "media-images");
		expect(mediaRow?.visitCount).toBe(0);
		expect(mediaRow?.lastVisitedAt).toBeNull();
	});

	it("degrades to empty trends when autonomous-maintenance-state.json is missing", async () => {
		if (tempDir) {
			await fs.rm(path.join(tempDir, ".hermes", "autonomous-maintenance-state.json"));
		}
		const trends = await computeQaReportTrends();
		expect(trends.cards).toEqual([]);
		expect(trends.dailyBuckets).toEqual([]);
		expect(trends.moduleCoverage).toEqual([]);
		expect(trends.recentRuns).toEqual([]);
		expect(trends.lastFailure).toBeNull();
	});

	it("degrades to empty trends when autonomous-maintenance-state.json is malformed", async () => {
		if (tempDir) {
			await fs.writeFile(
				path.join(tempDir, ".hermes", "autonomous-maintenance-state.json"),
				"not-json",
				"utf8",
			);
		}
		const trends = await computeQaReportTrends();
		expect(trends.cards).toEqual([]);
		expect(trends.recentRuns).toEqual([]);
	});

	it("ignores completed_runs with invalid timestamps and surfaces lastFailure when present", async () => {
		if (tempDir) {
			await fs.writeFile(
				path.join(tempDir, ".hermes", "autonomous-maintenance-state.json"),
				JSON.stringify(
					makeAutonomousMaintenanceState({
						completed_runs: [
							{
								timestamp_utc: "not-a-date",
								module: "downloads",
								result: "deployed_committed_pushed",
								summary: "ignored",
							},
						],
					}),
				),
				"utf8",
			);
		}
		const trends = await computeQaReportTrends();
		expect(trends.recentRuns).toEqual([]);
		expect(trends.lastFailure).toBeNull();
	});

	it("exposes the last failure with module + truncated summary", async () => {
		const trends = await computeQaReportTrends();
		expect(trends.lastFailure).not.toBeNull();
		expect(trends.lastFailure?.module).toBe("downloads");
		expect(trends.lastFailure?.summary.length).toBeLessThanOrEqual(170);
		expect(trends.lastFailure?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe("qa-reports/service.listQaReports with trends", () => {
	it("attaches a non-empty trends field to the list result", async () => {
		const result = await listQaReports();
		expect(result.trends).toBeDefined();
		expect(result.trends.cards.length).toBeGreaterThan(0);
		expect(result.trends.recentRuns.length).toBeGreaterThan(0);
		// lastUpdatedAt is the max of every source; this fixture has no
		// autonomous-maintenance-state.json#updatedAt so it stays at the
		// remediation-state.json value.
		expect(result.lastUpdatedAt).toBe("2026-06-11T16:28:00Z");
	});

	it("attaches an empty trends payload when autonomous-maintenance-state.json is missing", async () => {
		if (tempDir) {
			await fs.rm(path.join(tempDir, ".hermes", "autonomous-maintenance-state.json"));
		}
		const result = await listQaReports();
		expect(result.trends.cards).toEqual([]);
		expect(result.trends.dailyBuckets).toEqual([]);
		expect(result.trends.lastFailure).toBeNull();
		// The slice / blocker / qa_run aggregates are unaffected
		expect(result.totals.total).toBe(3);
	});
});
