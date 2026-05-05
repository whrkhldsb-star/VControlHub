"use client";

import { useCallback } from "react";

/* ── Unified API error handler ────────────────────────────── */

export type ApiError = {
	message: string;
	status: number;
	code?: string;
};

export function useApiErrorHandler() {
	const handleError = useCallback((err: unknown): ApiError => {
		if (err instanceof Response) {
			const status = err.status;
			switch (status) {
				case 401: return { message: "登录已过期，请重新登录", status, code: "UNAUTHORIZED" };
				case 403: return { message: "权限不足，无法执行此操作", status, code: "FORBIDDEN" };
				case 404: return { message: "请求的资源不存在", status, code: "NOT_FOUND" };
				case 429: return { message: "操作过于频繁，请稍后再试", status, code: "RATE_LIMITED" };
				case 500: return { message: "服务器内部错误，请稍后重试", status, code: "SERVER_ERROR" };
				default: return { message: `请求失败 (${status})`, status };
			}
		}
		if (err instanceof Error) {
			return { message: err.message, status: 0 };
		}
		if (typeof err === "object" && err !== null && "error" in err) {
			return { message: String((err as Record<string, unknown>).error), status: 0 };
		}
		return { message: "未知错误", status: 0 };
	}, []);

	return { handleError };
}

/* ── Fetch wrapper with error handling ────────────────────── */

export async function apiFetch<T = unknown>(
	url: string,
	options?: RequestInit,
): Promise<T> {
	const res = await fetch(url, options);
	if (!res.ok) {
		let message = `请求失败 (${res.status})`;
		try {
			const data = await res.json();
			if (data.error) message = String(data.error);
		} catch { /* ignore parse error */ }
		throw { message, status: res.status };
	}
	return res.json() as Promise<T>;
}
