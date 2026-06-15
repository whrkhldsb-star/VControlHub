import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getQaReportDetail, listQaReports } from "../service";

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
