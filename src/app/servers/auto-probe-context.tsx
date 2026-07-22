"use client";

/**
 * VPS 自动探测设置 — 客户端 Context，数据源从 localStorage 迁到 /api/preferences。
 *
 * 背景：
 *   - 旧实现：控件放在 /servers 页面内，enabled/intervalSec 存 localStorage
 *     (每浏览器独立，跨设备不共享)。
 *   - 新实现：设置由 /preferences 页面统一管理（持久化到 User.preferences
 *     JSON 字段），本 context 改为只读消费者 + 同步写入回 /api/preferences。
 *     跨浏览器 / 跨设备同步，且跟"自动刷新间隔"放同一处编辑。
 *
 * 该 Context 只承载"设置"，不集中管理 fetch；每张卡片仍各自调用
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

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import {
	DEFAULT_AUTO_PROBE_INTERVAL_SEC,
	normalizeAutoProbeIntervalSec,
} from "@/lib/preferences/auto-probe";
import { normalizeUserPreferences, type UserPreferences } from "@/lib/preferences/user-preferences";

type AutoProbeContextValue = {
	enabled: boolean;
	intervalSec: number;
	setEnabled: (next: boolean) => void;
	setIntervalSec: (next: number) => void;
	/** Hydrated=true 表示已从 /api/preferences 读到真值，可以开始触发自动探测。 */
	hydrated: boolean;
};

const AutoProbeContext = createContext<AutoProbeContextValue | null>(null);

const DEFAULT_ENABLED = true;

export function AutoProbeProvider({ children }: { children: ReactNode }) {
	// SSR / 首屏使用默认值，避免 hydration mismatch。
	const [enabled, setEnabledState] = useState<boolean>(DEFAULT_ENABLED);
	const [intervalSec, setIntervalSecState] = useState<number>(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
	const [hydrated, setHydrated] = useState(false);
	const { addToast } = useToast();
	const { t } = useI18n();

	useEffect(() => {
		let cancelled = false;
		// hydration: SSR 默认值挂载后从 /api/preferences 拉真值覆盖；client-only 状态同步。
		void (async () => {
			try {
				const data = await csrfFetch<Partial<UserPreferences>>("/api/preferences");
				if (cancelled) return;
				const normalized = normalizeUserPreferences(data);
				setEnabledState(normalized.autoProbeEnabled);
				setIntervalSecState(
					normalizeAutoProbeIntervalSec(
						normalized.autoProbeIntervalSec,
						DEFAULT_AUTO_PROBE_INTERVAL_SEC,
					),
				);
			} catch {
				// 网络/权限失败时继续使用默认值，下一次切换 setEnabled/setIntervalSec
				// 也会再次触发 PUT，把当前默认值推上去。
			} finally {
				if (!cancelled) setHydrated(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const persist = useCallback(async (next: { autoProbeEnabled?: boolean; autoProbeIntervalSec?: number }) => {
		try {
			await csrfFetch("/api/preferences", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(next),
			});
		} catch {
			addToast("error", t("serversPage.autoProbe.saveFailed"));
		}
	}, [addToast, t]);

	const setEnabled = useCallback(
		(next: boolean) => {
			setEnabledState(next);
			void persist({ autoProbeEnabled: next });
		},
		[persist],
	);

	const setIntervalSec = useCallback(
		(next: number) => {
			const normalized = normalizeAutoProbeIntervalSec(next, DEFAULT_AUTO_PROBE_INTERVAL_SEC);
			setIntervalSecState(normalized);
			void persist({ autoProbeIntervalSec: normalized });
		},
		[persist],
	);

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
