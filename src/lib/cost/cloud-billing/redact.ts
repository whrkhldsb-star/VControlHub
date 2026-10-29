import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey, Permission } from "@/lib/auth/rbac";

import type { CloudBillingAccountRecord } from "./types";

/**
 * The CSV sample an account was set up with and its billing feed URL (which often carries a signed token) are
 * inputs of whoever manages the account. A reader of the cost pages gets the account without them.
 */
export function redactCloudBillingAccountForReader<T extends Pick<CloudBillingAccountRecord, "config">>(
	account: T,
	session: { roles: RoleKey[]; permissions?: Permission[] },
): T {
	if (sessionHasPermission(session, "cost:manage")) return account;
	const { sampleCsv: _sample, billingCsvUrl: _url, ...config } = account.config;
	return { ...account, config };
}
