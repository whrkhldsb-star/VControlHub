/**
 * Sort state for the file list, plus the small SortIcon UI affordance.
 * Kept separate from the giant FileListClient so the click/sort logic
 * can be unit-tested in isolation.
 */

import { useCallback, useState, type ReactNode } from "react";
import type { FileListSortDir, FileListSortKey } from "./file-list-model";

export type SortState = {
	readonly key: FileListSortKey;
	readonly dir: FileListSortDir;
};

/**
 * Holds sort state and provides a `toggleSort` that:
 *  - same column → flips direction
 *  - different column → resets to ascending
 */
export function useFileListSort(initial: SortState = { key: "name", dir: "asc" }) {
	const [sortKey, setSortKey] = useState<FileListSortKey>(initial.key);
	const [sortDir, setSortDir] = useState<FileListSortDir>(initial.dir);

	const toggleSort = useCallback((key: FileListSortKey) => {
		setSortKey((prev) => {
			if (prev === key) {
				setSortDir((d) => (d === "asc" ? "desc" : "asc"));
				return key;
			}
			setSortDir("asc");
			return key;
		});
	}, []);

	return { sortKey, sortDir, toggleSort } as const;
}

export function SortIcon({
	col,
	label,
	sortKey,
	sortDir,
	onToggle,
}: {
	col: FileListSortKey;
	label: string;
	sortKey: FileListSortKey;
	sortDir: FileListSortDir;
	onToggle: (key: FileListSortKey) => void;
}): ReactNode {
	const active = sortKey === col;
	return (
		<button
			type="button"
			onClick={() => onToggle(col)}
			aria-label={`Sort by ${label}`}
			className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)] transition"
		>
			{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
		</button>
	);
}
