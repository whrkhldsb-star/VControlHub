import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey, Permission } from "@/lib/auth/rbac";

import type { CloudBillingAccountRecord } from "./types";

/**
 * The CSV sample an account was set up with and its billing feed URL (which often carries a signed token) are
 * inputs of whoever manages the account. A reader of the cost pages gets the account without them.
 */
export function redactCloudBillingAccountForReader(
	account: CloudBillingAccountRecord,
	session: { roles: RoleKey[]; permissions?: Permission[] },
): CloudBillingAccountRecord {
	if (sessionHasPermission(session, "cost:manage")) return account;
	const { sampleCsv: _sample, billingCsvUrl: _url, ...config } = account.config;
	const issues = account.lastSyncIssues ?? [];
	const summary = issues.map(({ row, reason }) => `CSV #${row} (${reason})`).join(", ");
	return { ...account, config, lastSyncError: account.lastSyncError ? summary || account.lastSyncStatus : null };
}
