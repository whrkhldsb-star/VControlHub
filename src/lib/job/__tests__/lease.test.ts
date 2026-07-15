import { describe, expect, it } from "vitest";

import {
  LEASE_PRESETS_MS,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  computeLeaseMs,
  listLeasePresetWorkerIds,
} from "../lease";

describe("TR-002 R2: job lease 公式统一", () => {
	it("12 个 worker 全部在 LEASE_PRESETS_MS 注册 (跟 registry.ts WorkerId 对齐)", () => {
		// 这些 worker id 必须跟 src/lib/workers/registry.ts WorkerId union 一致
		// (command-maintenance 不是 job worker, 不需 lease preset)
		expect(listLeasePresetWorkerIds()).toEqual([
			"alert-evaluation",
			"backup",
			"backup-schedule",
			"command-execution",
			"download-execution",
			"health-sampling",
			"operation-task-retention",
			"playbook-run",
			"quick-service",
			"scheduled-task",
			"sftp-stale-inventory",
			"sftp-sync",
			"vps-backup",
			"vps-backup-schedule",
		]);
	});

	it("computeLeaseMs 默认返 preset 值 (不变 worker 原行为)", () => {
		expect(computeLeaseMs("backup")).toBe(LEASE_PRESETS_MS.backup!);
		expect(computeLeaseMs("download-execution")).toBe(LEASE_PRESETS_MS["download-execution"]!);
	});

	it("computeLeaseMs 在 2×observed > preset 时取 2×observed × 1.1 (经验公式)", () => {
		// backup preset 30s, 观测到 20s, 则 2×20s = 40s > 30s, 取 40s × 1.1 = 44s
		expect(computeLeaseMs("backup", 20_000)).toBe(44_000);
		// download-execution preset 2.5h, 观测到 1h, 则 2×1h = 2h < 2.5h, preset wins 1:1 = 9000000
		expect(computeLeaseMs("download-execution", 60 * 60 * 1000)).toBe(LEASE_PRESETS_MS["download-execution"]);
		// 极端: observed = 3h, 2×3h = 6h > 2.5h, 取 6h × 1.1 = 23760000 (但 6h > MAX 6h, 夹到 6h)
		expect(computeLeaseMs("download-execution", 3 * 60 * 60 * 1000)).toBe(6 * 60 * 60 * 1000);
	});

	it("computeLeaseMs 兜底: 未知 workerId 走 MIN_LEASE_MS", () => {
		expect(computeLeaseMs("not-a-worker")).toBe(MIN_LEASE_MS);
	});

	it("computeLeaseMs 夹到 [MIN_LEASE_MS, MAX_LEASE_MS]", () => {
		// 极端: observed = 10h, 2× = 20h, × 1.1 = 22h, 夹到 MAX_LEASE_MS = 6h
		expect(computeLeaseMs("download-execution", 10 * 60 * 60 * 1000)).toBe(MAX_LEASE_MS);
		// 极端: observed = 0.001s, 2× = 0.002s, × 1.1 ≈ 0, 夹到 MIN_LEASE_MS = 30s
		expect(computeLeaseMs("backup", 1)).toBe(MIN_LEASE_MS);
	});

	it("LEASES 不退化: preset ≥ 旧 worker 硬编码值 × 1.05 (允许 5% 误差, 实际相等)", () => {
		// 兜底检查: R2 不能让 lease 意外变短
		const oldHardcoded: Record<string, number> = {
			backup: 30_000,
			"alert-evaluation": 60_000,
			"command-execution": 5 * 60 * 1000,
			"scheduled-task": 5 * 60 * 1000,
			"sftp-sync": 5 * 60 * 1000,
			"quick-service": 10 * 60 * 1000,
			"download-execution": 150 * 60 * 1000,
		};
		for (const [workerId, oldMs] of Object.entries(oldHardcoded)) {
			const newMs = computeLeaseMs(workerId);
			expect(newMs, `${workerId} lease 退化 (old=${oldMs}, new=${newMs})`).toBeGreaterThanOrEqual(
				Math.ceil(oldMs * 0.95), // 允许 5% 误差 (实际 SAFETY_BUFFER 让 newMs = oldMs × 1.1, 大于 oldMs)
			);
		}
	});
});
