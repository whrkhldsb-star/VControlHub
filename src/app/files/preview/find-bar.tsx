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
import { ActionButton } from "@/components/action-button";

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
			<div className="flex min-w-0 w-full flex-col gap-1 sm:w-36">
				<label
					htmlFor="text-preview-search"
					className="text-xs font-medium text-[var(--text-secondary)]"
				>
					{t("textPreview.find.searchLabel")}
				</label>
				<input
					id="text-preview-search"
					type="text"
					value={searchQuery}
					onChange={(e) => onSearchQueryChange(e.target.value)}
					placeholder={t("textPreview.find.searchPlaceholder")}
					className={cn(UI_INPUT, "px-2 py-1 text-sm text-[var(--text-secondary)]")}
				/>
			</div>
			<div className="flex w-full min-w-0 items-end gap-2 sm:w-auto">
				<div className="flex min-w-0 flex-1 flex-col gap-1 sm:w-24 sm:flex-none">
					<label
						htmlFor="text-preview-jump-line"
						className="text-xs font-medium text-[var(--text-secondary)]"
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
						className={cn(UI_INPUT, "px-2 py-1 text-sm text-[var(--text-secondary)]")}
					/>
				</div>
				<ActionButton variant="secondary"
					onClick={onJumpToLine} className="shrink-0 whitespace-nowrap !px-3 !py-1 !text-sm">
					{t("textPreview.find.jumpButton")}
				</ActionButton>
			</div>
		</>
	);
}
