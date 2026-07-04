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
		<div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
			<button
				type="button"
				onClick={(e) => handleClick("current", e)}
				className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
					scope ==="current"
						?"border border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]"
						:"text-[var(--text-secondary)] hover:text-[var(--text-secondary)] light:hover:text-[var(--text-disabled)]"
				}`}
			>
				当前目录
			</button>
			<button
				type="button"
				onClick={(e) => handleClick("all", e)}
				className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
					scope ==="all"
						?"border border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]"
						:"text-[var(--text-secondary)] hover:text-[var(--text-secondary)] light:hover:text-[var(--text-disabled)]"
				}`}
			>
				全部文件
			</button>
		</div>
	);
}
