/** Cost service public API — implementations are grouped by responsibility. */
export {
	createCostEntry,
	updateCostEntry,
	deleteCostEntry,
	getCostEntry,
	listCostEntries,
	summarizeMonth,
	listRecentSnapshots,
	syncServerMonthlyCosts,
} from "./service-entries";
export type { ListCostEntriesOptions, ServerMonthlyCostSyncResult } from "./service-entries";

export {
	getBudgetPeriodRange,
	createCostBudget,
	listCostBudgets,
	getCostBudget,
	updateCostBudget,
	deleteCostBudget,
	checkBudgetAlerts,
} from "./service-budgets";

export { upsertDailySnapshot } from "./service-snapshots";
export type { SnapshotWriteInput } from "./service-snapshots";

export {
	toRecord as costEntryToRecord,
	toSnapshot as costSnapshotToRecord,
} from "./service-internals";
