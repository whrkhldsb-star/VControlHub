/**
 * TR-002 R2: 跨 worker lease 公式统一。
 *
 * 之前 7 个 job worker 各自硬编码 *_LEASE_MS 常量，值从 30s 到 2.5h 不等。
 * 经验公式（README TR-001 T12 实测）：
 *   leaseMs ≥ 2 × maxSingleDispatchDuration
 *
 * 本模块提供：
 *   - LEASE_PRESETS_MS：每个 worker 的"经验" lease 兜底（保证原行为不退化）
 *   - computeLeaseMs(workerId, observedMaxDispatchMs?)：返
 *       max(preset, 2 × observedMaxDispatchMs) × 1.1
 *     (10% safety buffer, 防止 observed 抖动)
 *
 * 接入方式：
 *   import { computeLeaseMs } from "@/lib/job/lease";
 *   const job = await claimNextJob({ ..., leaseMs: computeLeaseMs("backup") });
 *
 * 新增 worker 时：
 *   1. 在 LEASE_PRESETS_MS 加 worker 兜底值
 *   2. test 加 case 覆盖（preset ≤ 2× maxDispatch 上限 + preset ≥ 当前硬编码）
 */

const SAFETY_BUFFER = 1.1; // 10% safety buffer on top of max(preset, 2×observed)

/**
 * Per-worker lease 兜底值 (ms)。值与原各 worker 的 *_LEASE_MS 常量一致，
 * 改成字典集中管理以便审计 + 后续接 dynamic config / runtime settings。
 *
 * 计算依据（参考 T12 实测 maxSingleDispatchDuration）：
 *   - backup 30s: 备份命令一般 < 15s，2× = 30s 足够
 *   - alert-evaluation 60s: 告警评估 < 30s
 *   - command-execution 5min: SSH 命令 + 远端执行可到 2-3min
 *   - scheduled-task 5min: 调度任务一般 < 2min
 *   - sftp-sync 5min: 大目录同步可到 2-3min
 *   - quick-service 10min: docker pull / build 长操作
 *   - download-execution 2.5h: 极大文件下载可到 1h+
 */
export const LEASE_PRESETS_MS: Record<string, number> = {
	backup: 30_000,
	"alert-evaluation": 60_000,
	"command-execution": 5 * 60 * 1000,
	"scheduled-task": 5 * 60 * 1000,
	"backup-schedule": 5 * 60 * 1000,
	"sftp-sync": 5 * 60 * 1000,
	"sftp-stale-inventory": 5 * 60 * 1000,
	"quick-service": 10 * 60 * 1000,
	"download-execution": 150 * 60 * 1000,
	// TR-006: 跨来源裁剪历史 5min lease 足够 (pruneOperationTaskHistory 大型实例 30s-1min)
	"operation-task-retention": 5 * 60 * 1000,
};

/** Minimum safety floor: 任何 worker 的 lease 不少于 30s (太短会让长任务被误回收) */
export const MIN_LEASE_MS = 30_000;

/** Maximum safety ceiling: 任何 worker 的 lease 不超过 6h (太长会让卡死任务占用 slot 过久) */
export const MAX_LEASE_MS = 6 * 60 * 60 * 1000;

/**
 * 计算 worker 的 lease ms。
 *
 * 公式:
 *   - 无 observedMaxDispatchMs: 返 preset × 1.0 (保原 worker 行为, 1:1 替换)
 *   - 有 observedMaxDispatchMs: 返 max(preset, 2 × observed) × 1.1
 *     (10% safety buffer, 防止 observed 抖动)
 *   - 夹到 [MIN_LEASE_MS, MAX_LEASE_MS]
 *
 * @param workerId  worker 标识 (与 WorkerId union 对应, 此处用 string 避免循环依赖)
 * @param observedMaxDispatchMs  (可选) 观测到的 max single dispatch duration
 * @returns lease ms
 */
export function computeLeaseMs(workerId: string, observedMaxDispatchMs?: number): number {
	const preset = LEASE_PRESETS_MS[workerId] ?? MIN_LEASE_MS;
	// 无观测数据: 1:1 返 preset, 保 R1 worker 行为不退化
	if (observedMaxDispatchMs === undefined) {
		return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, preset));
	}
	// 有观测数据但 2×observed ≤ preset: preset 足够, 1:1 返 preset (避免无谓延长)
	const observedFloor = 2 * observedMaxDispatchMs;
	if (observedFloor <= preset) {
		return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, preset));
	}
	// observed 超过 preset: × 1.1 buffer 防止抖动
	const withBuffer = Math.ceil(observedFloor * SAFETY_BUFFER);
	return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, withBuffer));
}

/** 列出已注册 lease preset 的所有 worker id, 便于 registry / test 验证无遗漏 */
export function listLeasePresetWorkerIds(): string[] {
	return Object.keys(LEASE_PRESETS_MS).sort();
}
