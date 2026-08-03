"use client";

/**
 * useAsyncAction — 统一「异步操作 + busy 态 + 错误提取」的共享 hook。
 *
 * 背景:审查发现 130+ 处组件手写
 *   `try { setBusy(id); await csrfFetch(...) } catch (e) {
 *      setError(e instanceof Error ? e.message : fallback) } finally { setBusy(null) }`
 * 该 hook 把这一模式收敛为单一实现;错误提取统一走 lib/http/error-message。
 *
 * 两种反馈风格由调用方选择:
 *   - `onError` 缺省时错误存入返回的 `error` state(本地红条风格);
 *   - 传入 `onError`(如 toast)时不占用本地 state。
 *
 * 用法:
 *   const { run, busyKey, error, setError } = useAsyncAction();
 *   <button disabled={busyKey === job.id}
 *     onClick={() => run(job.id, async () => { await csrfFetch(...); await load(); },
 *       { fallback: t("xx.failed") })}>
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getErrorMessage } from "@/lib/http/error-message";

export type AsyncActionOptions = {
	/** 错误消息兜底文案(必传,保证不出现空白提示)。 */
	fallback: string;
	/** 自定义错误出口(如 addToast);缺省写入 hook 的 error state。 */
	onError?: (message: string) => void;
	/** 成功回调(可选,便于串 toast/刷新)。 */
	onSuccess?: () => void;
};

export function useAsyncAction() {
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Prevents setState after the component unmounts.
	const aliveRef = useRef(true);
	// Mirrors busyKey for synchronous re-entry checks (state is async).
	const busyKeyRef = useRef<string | null>(null);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
		};
	}, []);

	const run = useCallback(
		async <T>(key: string, action: () => Promise<T>, opts: AsyncActionOptions): Promise<T | undefined> => {
			// Single busy slot: reject a second run while one is in flight so a
			// finishing run can never clear a newer run's busy state early.
			if (busyKeyRef.current !== null) return undefined;
			busyKeyRef.current = key;
			setBusyKey(key);
			setError(null);
			try {
				const result = await action();
				opts.onSuccess?.();
				return result;
			} catch (cause) {
				const message = getErrorMessage(cause, opts.fallback);
				if (opts.onError) opts.onError(message);
				else if (aliveRef.current) setError(message);
				return undefined;
			} finally {
				busyKeyRef.current = null;
				if (aliveRef.current) setBusyKey(null);
			}
		},
		[],
	);

	const clearError = useCallback(() => setError(null), []);

	return { run, busyKey, error, setError, clearError };
}
