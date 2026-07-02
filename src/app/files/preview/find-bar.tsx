/**
 * Real `FindBar` component.
 *
 * TR-036: Split out from `text-preview-client.tsx` so the search
 * input + jump-to-line control only ship in the client chunk when
 * the user enters the text preview. The page itself ships the
 * language label, edit controls and content viewer; the find/jump
 * chunk arrives on first view.
 *
 * State (`searchQuery` / `jumpLine`) and the jump-to-line callback
 * stay owned by the parent so closing the preview (route change)
 * resets them and the chunk boundary is purely about deferring
 * code, not about data flow. The lazy wrapper renders nothing when
 * `editMode === true` (the find/jump affordances are hidden in
 * edit mode), letting the parent drop the conditional.
 */
"use client";

import { useI18n } from "@/lib/i18n/use-locale";

export interface FindBarProps {
	searchQuery: string;
	onSearchQueryChange: (next: string) => void;
	jumpLine: string;
	onJumpLineChange: (next: string) => void;
	onJumpToLine: () => void;
}

export function FindBar({
	searchQuery,
	onSearchQueryChange,
	jumpLine,
	onJumpLineChange,
	onJumpToLine,
}: FindBarProps) {
	const { t } = useI18n();
	return (
		<>
			<div className="flex flex-col gap-1">
				<label
					htmlFor="text-preview-search"
					className="text-[11px] font-medium text-[var(--text-secondary)]"
				>
					{t("textPreview.find.searchLabel")}
				</label>
				<input
					id="text-preview-search"
					type="text"
					value={searchQuery}
					onChange={(e) => onSearchQueryChange(e.target.value)}
					placeholder={t("textPreview.find.searchPlaceholder")}
					className="w-36 rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
				/>
			</div>
			<div className="flex items-end gap-1">
				<div className="flex flex-col gap-1">
					<label
						htmlFor="text-preview-jump-line"
						className="text-[11px] font-medium text-[var(--text-secondary)]"
					>
						{t("textPreview.find.jumpLabel")}
					</label>
					<input
						id="text-preview-jump-line"
						type="text"
						inputMode="numeric"
						value={jumpLine}
						onChange={(e) => onJumpLineChange(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && onJumpToLine()}
						placeholder={t("textPreview.find.jumpPlaceholder")}
						className="w-24 rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
					/>
				</div>
				<button
					type="button"
					onClick={onJumpToLine}
					className="rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-slate-200"
				>
					{t("textPreview.find.jumpButton")}
				</button>
			</div>
		</>
	);
}
