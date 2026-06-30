"use client";

import { useEffect } from "react";

/**
 * Global Error Boundary — catches unhandled errors in any route segment.
 * Without this, an uncaught exception renders a blank white page.
 * Placed at src/app/global-error.tsx (app router convention).
 */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[GlobalError]", error);
	}, [error]);

	return (
		<html lang="zh-CN">
			<body className="m-0 bg-[var(--surface-root)] p-0 font-sans text-[var(--text-primary)]">
				<div className="mx-auto max-w-[600px] px-6 py-20 text-center">
					<h1 className="mb-3 text-3xl font-semibold text-[var(--text-primary)]">出错了</h1>
					<p className="mb-6 text-base leading-relaxed text-[var(--text-secondary)]">
						页面遇到了意外错误，请尝试刷新。如果问题持续出现，请联系管理员。
					</p>
					{error.digest && (
						<p className="mb-4 text-xs text-[var(--text-muted)]">错误标识: {error.digest}</p>
					)}
					<button
						onClick={reset}
						className="rounded-lg bg-[var(--color-action)] px-7 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--color-action-hover)]"
					>
						重试
					</button>
				</div>
			</body>
		</html>
	);
}
