/**
 * Board query parsing — shared by the API route, the server-rendered page
 * and the browser URL state, so a shared link shows the same page everywhere.
 */
import type { PublicBoardQuery, PublicBoardSort, PublicBoardStatusFilter, PublicHistoryRange } from "./types";

export const BOARD_SORTS: readonly PublicBoardSort[] = ["default", "name", "cpu", "memory", "disk", "network", "status"];
export const BOARD_STATUS_FILTERS: readonly PublicBoardStatusFilter[] = ["all", "online", "offline", "stale", "unknown", "maintenance"];
export const HISTORY_RANGES: readonly PublicHistoryRange[] = ["1h", "6h", "24h", "7d"];
export const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const;
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
export const MAX_QUERY_LENGTH = 100;
export const MAX_PAGE = 10_000;

export const DEFAULT_BOARD_QUERY: PublicBoardQuery = {
	q: "",
	group: "",
	status: "all",
	sort: "default",
	dir: "asc",
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE,
};

type ParamSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function read(source: ParamSource, name: string): string | null {
	if (typeof (source as { get?: unknown }).get === "function") {
		return (source as { get(name: string): string | null }).get(name);
	}
	const value = (source as Record<string, string | string[] | undefined>)[name];
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
	if (raw === null || !/^\d{1,6}$/.test(raw)) return fallback;
	return Math.min(max, Math.max(min, Number(raw)));
}

export function parseBoardQuery(source: ParamSource): PublicBoardQuery {
	const sortRaw = read(source, "sort");
	const statusRaw = read(source, "status");
	const dirRaw = read(source, "dir");
	return {
		q: (read(source, "q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
		group: (read(source, "group") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
		status: BOARD_STATUS_FILTERS.includes(statusRaw as PublicBoardStatusFilter) ? (statusRaw as PublicBoardStatusFilter) : "all",
		sort: BOARD_SORTS.includes(sortRaw as PublicBoardSort) ? (sortRaw as PublicBoardSort) : "default",
		dir: dirRaw === "desc" ? "desc" : "asc",
		page: clampInt(read(source, "page"), 1, 1, MAX_PAGE),
		pageSize: clampInt(read(source, "pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
	};
}

/** URL search string for a query, omitting defaults (stable, shareable links). */
export function boardQueryToSearch(query: PublicBoardQuery): string {
	const params = new URLSearchParams();
	if (query.q) params.set("q", query.q);
	if (query.group) params.set("group", query.group);
	if (query.status !== "all") params.set("status", query.status);
	if (query.sort !== "default") params.set("sort", query.sort);
	if (query.dir !== "asc") params.set("dir", query.dir);
	if (query.page !== 1) params.set("page", String(query.page));
	if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
	return params.toString();
}

export function parseHistoryRange(raw: string | null | undefined): PublicHistoryRange {
	return HISTORY_RANGES.includes(raw as PublicHistoryRange) ? (raw as PublicHistoryRange) : "24h";
}

/** Public node ids are 12 lowercase base32 characters. */
export const PUBLIC_ID_PATTERN = /^[a-z2-7]{12}$/;
