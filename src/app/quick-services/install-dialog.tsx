"use client";

/**
 * `InstallDialog` — port-picker modal shown when the user clicks
 * "一键安装" on a Quick Service card. Lets the user override the
 * default port, runs a debounced port-availability probe, and shows
 * the resolved image / container-port / env / volume plan before the
 * final confirmation dialog.
 *
 * Extracted from `quick-services-client.tsx` (TR-036 T37). Owns its own
 * `customPort` / `portCheck` / debounce-timer state so the parent only
 * passes the open/close + "ready to advance" hooks. NOT lazy-loaded —
 * the install flow is the first thing a new admin hits, so the chunk
 * has to be available as soon as they click the tile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type InstallDialogItem = {
	slug: string;
	name: string;
	image: string;
	extraPorts?: Array<{ container: number; host: number }> | null;
	defaultPort: number;
	envKeyCount?: number | null;
	volumesJson?: Array<{ host: string; container: string }> | null;
	internalPort?: number | null;
};

type InstallDialogProps = {
	open: InstallDialogItem | null;
	onClose: () => void;
	onAdvance: (input: { slug: string; name: string; port: number }) => void;
	getEnvCount: (item: InstallDialogItem) => number;
	getVolumeMounts: (item: InstallDialogItem) => Array<{ host: string; container: string }>;
	getPrimaryContainerPort: (item: InstallDialogItem) => number;
};

type PortCheckState = {
	available: boolean;
	usedBy: string | null;
	checking: boolean;
};

export function InstallDialog({
	open,
	onClose,
	onAdvance,
	getEnvCount,
	getVolumeMounts,
	getPrimaryContainerPort,
}: InstallDialogProps) {
	const [customPort, setCustomPort] = useState<string>("");
	const [portCheck, setPortCheck] = useState<PortCheckState | null>(null);
	const portCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const checkPortAvailability = useCallback(async (port: number) => {
		setPortCheck({ available: false, usedBy: null, checking: true });
		try {
			const data = await csrfFetch<{ available: boolean; usedBy?: string | null }>(
				`/api/quick-services/check-port?port=${encodeURIComponent(String(port))}`,
			);
			setPortCheck({ available: data.available, usedBy: data.usedBy ?? null, checking: false });
		} catch (err) {
			setPortCheck({
				available: false,
				usedBy: err instanceof Error ? err.message : "检查失败",
				checking: false,
			});
		}
	}, []);

	// Reset state every time the dialog opens — the cascading render is the
	// desired behavior: open dialog → seed default port + immediate check.
	// (Following the same disable pattern as other dialogs in this repo,
	// e.g. `file-upload-dropzone.tsx`, `users-client.tsx`.)
	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		if (!open) return;
		setCustomPort(String(open.defaultPort));
		setPortCheck({ available: false, usedBy: null, checking: true });
		void checkPortAvailability(open.defaultPort);
		return () => {
			if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot init per open
	}, [open?.slug, checkPortAvailability]);
	/* eslint-enable react-hooks/set-state-in-effect */

	const handlePortInput = useCallback(
		(value: string) => {
			setCustomPort(value);
			if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
			const port = Number(value);
			if (!value || isNaN(port) || port < 1 || port > 65535) {
				setPortCheck(null);
				return;
			}
			portCheckTimer.current = setTimeout(() => {
				void checkPortAvailability(port);
			}, 400);
		},
		[checkPortAvailability],
	);

	if (!open) return null;

	const port = Number(customPort);
	const portValid = !isNaN(port) && port >= 1 && port <= 65535;
	const containerPort = getPrimaryContainerPort(open);
	const envCount = getEnvCount(open);
	const volumeCount = getVolumeMounts(open).length;
	const advanceDisabled = portCheck?.checking || (portCheck ? !portCheck.available : false);

	const handleAdvance = () => {
		if (!open || !portValid) return;
		if (portCheck && !portCheck.available) return;
		onAdvance({ slug: open.slug, name: open.name, port });
	};

	const handleAutoAllocate = async () => {
		try {
			const data = await csrfFetch<{ port?: number }>(
				`/api/quick-services/check-port?action=allocate&preferred=${open.defaultPort}`,
			);
			if (data.port) {
				handlePortInput(String(data.port));
			}
		} catch {
			/* ignore — user can still type manually */
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md mx-4 rounded-2xl border border-white/[0.08] bg-[#0c0f1a] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-white mb-1">安装 {open.name}</h3>
				<p className="text-xs text-slate-500 mb-4">选择服务监听的端口，安装后可通过该端口访问服务。</p>

				<div className="space-y-3">
					<label className="block">
						<span className="text-xs text-slate-400 mb-1 block">端口号</span>
						<div className="relative">
							<input
								type="number"
								min={1}
								max={65535}
								value={customPort}
								onChange={(e) => handlePortInput(e.target.value)}
								className={`w-full rounded-lg border bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition ${
									portCheck
										? portCheck.available
											? "border-emerald-400/40 focus:border-emerald-400"
											: "border-rose-400/40 focus:border-rose-400"
										: "border-white/[0.08] focus:border-cyan-400"
								}`}
								placeholder="1-65535"
							/>
							{portCheck?.checking && (
								<div className="absolute right-3 top-1/2 -translate-y-1/2">
									<div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
								</div>
							)}
							{portCheck && !portCheck.checking && (
								<div
									className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
										portCheck.available ? "text-emerald-400" : "text-rose-400"
									}`}
								>
									{portCheck.available ? "✓ 可用" : "✗ 占用"}
								</div>
							)}
						</div>
					</label>

					{portCheck && !portCheck.available && portCheck.usedBy && (
						<div className="text-xs text-rose-300/80 bg-rose-500/[0.06] rounded-lg px-3 py-2 border border-rose-400/10">
							端口被占用：{portCheck.usedBy}
						</div>
					)}

					<div data-tone="cyan" className="rounded-xl border border-cyan-400/15 p-3 text-xs text-cyan-100">
						<div className="font-semibold">安装前配置预览</div>
						<div className="mt-2 grid gap-1.5 text-cyan-100/80/75">
							<span>镜像：{open.image ?? "待刷新"}</span>
							<span>
								容器端口：{containerPort ?? "-"} → 宿主端口 {customPort || open.defaultPort}
							</span>
							<span>环境变量：{envCount} 个键（不展示密钥值）</span>
							<span>宿主机挂载：{volumeCount} 条</span>
						</div>
					</div>

					<div className="flex items-center gap-2 text-[10px] text-slate-500">
						<span>推荐端口: {open.defaultPort}</span>
						<button
							type="button"
							onClick={handleAutoAllocate}
							className="text-cyan-400/70 hover:text-cyan-300 underline underline-offset-2"
						>
							自动分配
						</button>
					</div>
				</div>

				<div className="flex items-center justify-end gap-3 mt-6">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition"
					>
						取消
					</button>
					<button
						type="button"
						onClick={handleAdvance}
						disabled={advanceDisabled}
						className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
					>
						确认安装
					</button>
				</div>
			</div>
		</div>
	);
}
