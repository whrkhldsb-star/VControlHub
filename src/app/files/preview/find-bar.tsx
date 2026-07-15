"use client";

/**
 * Real `FindBar` component.
 *
 * TR-036: Split out from `text-preview-client.tsx` so the search
 * input + jump-to-line control only ship in the client chunk when
 * the user enters the text preview.
 */

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

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
					className={cn(UI_INPUT, "w-36 px-2 py-1 text-xs text-[var(--text-secondary)]")}
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
						className={cn(UI_INPUT, "w-24 px-2 py-1 text-xs text-[var(--text-secondary)]")}
					/>
				</div>
				<button
					type="button"
					onClick={onJumpToLine}
					className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface)]"
				>
					{t("textPreview.find.jumpButton")}
				</button>
			</div>
		</>
	);
}
