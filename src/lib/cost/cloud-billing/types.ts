/**
 * Cloud billing account types (FEAT-COST-CLOUD-BILLING).
 *
 * Credentials never leave the service layer unencrypted.
 * Clients only see hasCredentials / lastSync* metadata.
 */
import type { CostCategory, CostCurrency } from "../types";

export const CLOUD_BILLING_PROVIDER_VALUES = [
	"aws",
	"aliyun",
	"tencent",
	"generic_csv",
] as const;
export type CloudBillingProvider = (typeof CLOUD_BILLING_PROVIDER_VALUES)[number];

export const CLOUD_BILLING_SYNC_STATUS_VALUES = [
	"running",
	"ok",
	"error",
	"partial",
] as const;
export type CloudBillingSyncStatus = (typeof CLOUD_BILLING_SYNC_STATUS_VALUES)[number];

/** Plain config hints (no secrets). */
export type CloudBillingAccountConfig = {
	/** AWS: Cost Explorer region or CUR bucket region */
	region?: string;
	/** Optional account / payer id for display */
	accountId?: string;
	/** generic_csv: sample payload embedded for dry-run import tests */
	sampleCsv?: string;
	/** Optional HTTPS URL returning CSV (date,amount,...) for live-ish import without vendor SDK */
	billingCsvUrl?: string;
	/** Map product family → CostCategory override */
	categoryMap?: Record<string, CostCategory>;
};

export type CloudBillingCredentials = {
	/** AWS access key / Aliyun AccessKeyId / Tencent SecretId / CSV token label */
	accessKeyId?: string;
	/** AWS secret / Aliyun AccessKeySecret / Tencent SecretKey */
	secretAccessKey?: string;
	/** Optional session token / STS */
	sessionToken?: string;
	/** Optional role ARN (AWS assume-role path; stored but not required for mock) */
	roleArn?: string;
};

export interface CloudBillingAccountRecord {
	id: string;
	name: string;
	provider: CloudBillingProvider;
	currency: CostCurrency;
	enabled: boolean;
	config: CloudBillingAccountConfig;
	hasCredentials: boolean;
	teamId: string | null;
	lastSyncAt: string | null;
	lastSyncStatus: CloudBillingSyncStatus | null;
	lastSyncError: string | null;
	lastSyncImported: number;
	lastSyncSkipped: number;
	createdById: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CloudBillingSyncRunRecord {
	id: string;
	accountId: string;
	month: string;
	status: CloudBillingSyncStatus;
	imported: number;
	skipped: number;
	errorMessage: string | null;
	startedAt: string;
	finishedAt: string | null;
}

export interface CloudBillingLineItem {
	/** Stable id for upsert (provider-specific charge id or hash) */
	externalId: string;
	category: CostCategory;
	/** Display provider label (e.g. "AWS · EC2") */
	providerLabel: string;
	amount: string;
	currency: CostCurrency;
	effectiveDate: string; // YYYY-MM-DD
	notes?: string;
	productCode?: string;
	tags?: string[];
}

export interface CloudBillingFetchResult {
	items: CloudBillingLineItem[];
	warnings: string[];
}
