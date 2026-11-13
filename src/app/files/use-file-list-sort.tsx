/**
 * Sort state for the file list. Kept separate from the giant FileListClient so the click/sort logic can be
 * unit-tested in isolation; the column headers draw their own indicator (file-list-views.tsx).
 */

import { useCallback, useState } from "react";
import type { FileListSortDir, FileListSortKey } from "./file-list-model";

export type SortState = {
	readonly key: FileListSortKey;
	readonly dir: FileListSortDir;
};

/**
 * Holds sort state and provides a `toggleSort` that:
 *  - same column → flips direction
 *  - different column → resets to ascending
 *
 * One state and one pure updater: the toggle used to call the direction's setter from inside the column's
 * updater, which React runs twice in development, so the direction flipped twice and stayed put there.
 */
export function useFileListSort(initial: SortState = { key: "name", dir: "asc" }) {
	const [sort, setSort] = useState<SortState>(initial);

	const toggleSort = useCallback((key: FileListSortKey) => {
		setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
	}, []);

	return { sortKey: sort.key, sortDir: sort.dir, toggleSort } as const;
}
