"use client";

/**
 * VPS 自动探测设置 — 客户端 Context + localStorage 持久化。
 *
 * 背景：
 *   - 进入 /servers 页面时每张 ServerOverviewCard 默认显示「启用 · 待探测」，
 *     需要用户手动展开详情并点击「运行实时探测」。
 *   - React state 在路由切换后被丢弃，回到页面又回到 idle，体验差。
 *
 * 方案：
 *   - 提供页面级开关「自动探测」+ 可选间隔（10/30/60/120/300s）。
 *   - 卡片在挂载时自动跑一次，并按间隔周期刷新。
 *   - 设置写入 localStorage（每浏览器持久化），SSR 阶段读取默认值，hydration 后再
 *     用真实值覆盖，避免 hydration mismatch。
 *
 * 该 Context 只承载「设置」，不集中管理 fetch；每张卡片仍各自调用
 * /api/servers/monitor，沿用既有失败/成功状态机。
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export const AUTO_PROBE_INTERVAL_OPTIONS = [
	{ value: 10, label: "10 秒" },
	{ value: 30, label: "30 秒" },
	{ value: 60, label: "1 分钟" },
	{ value: 120, label: "2 分钟" },
	{ value: 300, label: "5 分钟" },
] as const;

export const DEFAULT_AUTO_PROBE_INTERVAL_SEC = 60;
export const DEFAULT_AUTO_PROBE_ENABLED = true;

const STORAGE_KEY_ENABLED = "vch.servers.autoProbe.enabled";
const STORAGE_KEY_INTERVAL = "vch.servers.autoProbe.intervalSec";

type AutoProbeContextValue = {
	enabled: boolean;
	intervalSec: number;
	setEnabled: (next: boolean) => void;
	setIntervalSec: (next: number) => void;
	/** Hydrated=true 表示客户端已读取 localStorage，可以开始触发自动探测。 */
	hydrated: boolean;
};

const AutoProbeContext = createContext<AutoProbeContextValue | null>(null);

function readBool(key: string, fallback: boolean): boolean {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return fallback;
		return raw === "true";
	} catch {
		return fallback;
	}
}

function readInterval(key: string, fallback: number): number {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return fallback;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return fallback;
		const allowed = AUTO_PROBE_INTERVAL_OPTIONS.some((opt) => opt.value === parsed);
		return allowed ? parsed : fallback;
	} catch {
		return fallback;
	}
}

export function AutoProbeProvider({ children }: { children: ReactNode }) {
	// SSR / 首屏使用默认值，避免 hydration mismatch。
	const [enabled, setEnabledState] = useState<boolean>(DEFAULT_AUTO_PROBE_ENABLED);
	const [intervalSec, setIntervalSecState] = useState<number>(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: 在 SSR 默认值挂载之后，从 localStorage 读真实值并切到 hydrated。这是 client-only 状态同步的标准做法，无法用 useSyncExternalStore 替代（需要 SSR 默认值不同）。
		setEnabledState(readBool(STORAGE_KEY_ENABLED, DEFAULT_AUTO_PROBE_ENABLED));
		setIntervalSecState(readInterval(STORAGE_KEY_INTERVAL, DEFAULT_AUTO_PROBE_INTERVAL_SEC));
		setHydrated(true);
	}, []);

	const setEnabled = useCallback((next: boolean) => {
		setEnabledState(next);
		if (typeof window !== "undefined") {
			try {
				window.localStorage.setItem(STORAGE_KEY_ENABLED, String(next));
			} catch {
				// 隐私模式 / 配额不足：忽略，下次仍按默认值进入
			}
		}
	}, []);

	const setIntervalSec = useCallback((next: number) => {
		setIntervalSecState(next);
		if (typeof window !== "undefined") {
			try {
				window.localStorage.setItem(STORAGE_KEY_INTERVAL, String(next));
			} catch {
				// 同上
			}
		}
	}, []);

	const value = useMemo<AutoProbeContextValue>(
		() => ({ enabled, intervalSec, setEnabled, setIntervalSec, hydrated }),
		[enabled, intervalSec, setEnabled, setIntervalSec, hydrated],
	);

	return <AutoProbeContext.Provider value={value}>{children}</AutoProbeContext.Provider>;
}

/**
 * 在 Provider 之外调用时返回一份「禁用」的快照，让卡片在没有 Provider 的
 * 测试或老页面里静默退化为旧行为。
 */
export function useAutoProbeSettings(): AutoProbeContextValue {
	const ctx = useContext(AutoProbeContext);
	if (ctx) return ctx;
	return {
		enabled: false,
		intervalSec: DEFAULT_AUTO_PROBE_INTERVAL_SEC,
		setEnabled: () => undefined,
		setIntervalSec: () => undefined,
		hydrated: false,
	};
}
