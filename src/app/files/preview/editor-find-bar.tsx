"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import type { EditorFindState } from "./text-preview-types";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
/**
 * In-editor find toolbar shown above the textarea while editing.
 *
 * Split out from `text-preview-client.tsx`: the bar is a self-contained
 * presentational piece (input, match counter, prev/next/close). State
 * (`editorFind`) and the navigation logic that selects matches in the
 * textarea stay owned by the parent, which passes the shared input ref
 * plus callbacks. The parent still drives Ctrl+F focusing via the ref.
 */
export interface EditorFindBarProps {
	inputRef: React.RefObject<HTMLInputElement | null>;
	find: EditorFindState;
	onQueryChange: (query: string) => void;
	onMove: (direction: 1 | -1) => void;
	onClose: () => void;
}

export function EditorFindBar({ inputRef, find, onQueryChange, onMove, onClose }: EditorFindBarProps) {
	const { t } = useI18n();
	return (
		<div
			role="search"
			aria-label={t("textPreview.editor.findToggle")}
			data-testid="editor-find-bar"
			className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--surface)]/70 px-3 py-2"
		>
			<input
				ref={inputRef}
				type="text"
				value={find.query}
				aria-label={t("textPreview.editor.findPlaceholder")}
				onChange={(event) => onQueryChange(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onMove(event.shiftKey ? -1 : 1);
					}
				}}
				placeholder={t("textPreview.editor.findPlaceholder")}
				className={cn(UI_INPUT, "w-48 px-2 py-1 text-xs text-[var(--text-secondary)]")}
			/>
			<span className="text-xs text-[var(--text-secondary)]" data-testid="editor-find-count">
				{find.query === ""
					? ""
					: find.total === 0
						? t("textPreview.editor.findNoMatch")
						: t("textPreview.editor.findMatchCount")
							.replace("{current}", String(find.current))
							.replace("{total}", String(find.total))}
			</span>
			<div className="flex-1" />
			<button
				type="button"
				onClick={() => onMove(-1)}
				disabled={find.total === 0}
				aria-label={t("textPreview.editor.findPrev")}
				title={t("textPreview.editor.findPrev")}
				className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
			>
				↑
			</button>
			<button
				type="button"
				onClick={() => onMove(1)}
				disabled={find.total === 0}
				aria-label={t("textPreview.editor.findNext")}
				title={t("textPreview.editor.findNext")}
				className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
			>
				↓
			</button>
			<button
				type="button"
				onClick={onClose}
				aria-label={t("textPreview.editor.findClose")}
				title={t("textPreview.editor.findClose")}
			 data-action-button data-variant="secondary" className="!px-2 !py-1 !text-xs">
				✕
			</button>
		</div>
	);
}
