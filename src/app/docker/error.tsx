"use client";

import { useEffect } from "react";

export default function SubRouteError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[Route Error]", error);
	}, [error]);

	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
			<div className="rounded-full bg-rose-500/10 p-4">
				<svg className="h-8 w-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
				</svg>
			</div>
			<h2 className="text-lg font-semibold text-white">页面加载出错</h2>
			<p className="max-w-md text-center text-sm text-slate-400">
				{error.message || "发生了未知错误，请稍后重试。"}
			</p>
			<button
				onClick={reset}
				className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
			>
				重试
			</button>
		</div>
	);
}
