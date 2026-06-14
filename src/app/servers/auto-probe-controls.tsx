"use client";

/**
 * 页面级「自动探测」控件：
 *   - 复选框：是否在卡片挂载时自动跑一次 + 周期刷新
 *   - 下拉：刷新间隔（10/30/60/120/300 秒）
 *
 * 与卡片解耦：仅操作 AutoProbeContext，卡片内部消费设置即可。
 * SSR 时 hydrated=false，控件保持禁用 + 默认值，避免与 localStorage 真值闪烁。
 */

import {
	AUTO_PROBE_INTERVAL_OPTIONS,
	useAutoProbeSettings,
} from "./auto-probe-context";

export function AutoProbeControls() {
	const { enabled, intervalSec, setEnabled, setIntervalSec, hydrated } =
		useAutoProbeSettings();

	return (
		<div
			data-testid="auto-probe-controls"
			className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs text-slate-300"
		>
			<label className="inline-flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					checked={enabled}
					disabled={!hydrated}
					onChange={(event) => setEnabled(event.target.checked)}
					className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-slate-900 accent-cyan-400"
					aria-label="启用 VPS 自动探测"
				/>
				<span className="font-medium text-white/80">自动探测</span>
			</label>

			<div className="inline-flex items-center gap-2">
				<span className="text-slate-500">间隔</span>
				<select
					value={intervalSec}
					onChange={(event) => setIntervalSec(Number(event.target.value))}
					disabled={!hydrated || !enabled}
					aria-label="自动探测间隔"
					className="rounded-md border border-white/[0.08] bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{AUTO_PROBE_INTERVAL_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
			</div>

			<span className="text-[11px] text-slate-500">
				进入或切回页面时自动调用 /api/servers/monitor，仅作只读 SSH 采样。
			</span>
		</div>
	);
}
