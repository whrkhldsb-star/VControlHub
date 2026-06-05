"use client";

import { useCallback } from "react";

export function SearchScopeToggle({
	scope,
	onScopeChange,
}: {
	scope: "current" | "all";
	currentPath?: string;
	onScopeChange?: (newScope: string) => void;
}) {
	const handleClick = useCallback(
		(newScope: string, e: React.MouseEvent) => {
			if (onScopeChange) {
				onScopeChange(newScope);
				return;
			}
			// Fallback: form submit mode
			const button = e.currentTarget;
			const form = button.closest("form");
			if (!form) return;
			const input = form.querySelector('input[name="scope"]') as HTMLInputElement | null;
			if (input) {
				input.value = newScope;
			}
			form.submit();
		},
		[onScopeChange],
	);

	return (
		<div className="flex gap-1 rounded-full border border-white/10 light:border-slate-200 bg-slate-950/50 light:bg-white/50 p-1">
			<button
				type="button"
				onClick={(e) => handleClick("current", e)}
				className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
					scope ==="current"
						?"border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 light:text-cyan-900"
						:"text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800"
				}`}
			>
				当前目录
			</button>
			<button
				type="button"
				onClick={(e) => handleClick("all", e)}
				className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
					scope ==="all"
						?"border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 light:text-cyan-900"
						:"text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-800"
				}`}
			>
				全部文件
			</button>
		</div>
	);
}
