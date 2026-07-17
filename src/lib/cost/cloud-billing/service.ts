/**
 * Cloud billing account service (FEAT-COST-CLOUD-BILLING).
 *
 * - Credentials encrypted at rest (AES-256-GCM via encrypt/decrypt)
 * - Sync upserts CostEntry rows with sourceType=cloud_billing
 * - Unique key: sourceType + sourceRef + effectiveDate
 *   sourceRef = `${accountId}:${externalId}` (truncated to stay within index limits)
 * - Team scope via teamWhere / teamCreateData (multi-tenant)
 */
import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";

import type { CostCurrency } from "../types";
import { fetchCloudBillingItems } from "./adapters";
import {
	createCloudBillingAccountSchema,
	updateCloudBillingAccountSchema,
} from "./schema";
import type {
	CloudBillingAccountConfig,
	CloudBillingAccountRecord,
	CloudBillingCredentials,
	CloudBillingProvider,
	CloudBillingSyncRunRecord,
	CloudBillingSyncStatus,
} from "./types";

const logger = createLogger("cloud-billing");
const DEFAULT_CURRENCY: CostCurrency = "USD";
const SOURCE_TYPE = "cloud_billing";

type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

function tagValue(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/\s+/gu, "-").slice(0, 128);
}

function iso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

function parseConfig(raw: Prisma.JsonValue | null | undefined): CloudBillingAccountConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return raw as CloudBillingAccountConfig;
}

function encryptCredentials(creds: CloudBillingCredentials): string {
	return encrypt(JSON.stringify(creds));
}

function decryptCredentials(enc: string): CloudBillingCredentials {
	const plain = isEncrypted(enc) ? decrypt(enc) : enc;
	try {
		const parsed = JSON.parse(plain) as CloudBillingCredentials;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		throw new ValidationError("Stored cloud billing credentials are corrupt");
	}
}

function toAccountRecord(row: {
	id: string;
	name: string;
	provider: string;
	credentialsEnc: string;
	config: Prisma.JsonValue;
	currency: string;
	enabled: boolean;
	teamId: string | null;
	lastSyncAt: Date | null;
	lastSyncStatus: string | null;
	lastSyncError: string | null;
	lastSyncImported: number;
	lastSyncSkipped: number;
	createdById: string | null;
	createdAt: Date;
	updatedAt: Date;
}): CloudBillingAccountRecord {
	return {
		id: row.id,
		name: row.name,
		provider: row.provider as CloudBillingProvider,
		currency: (row.currency as CostCurrency) || DEFAULT_CURRENCY,
		enabled: row.enabled,
		config: parseConfig(row.config),
		hasCredentials: Boolean(row.credentialsEnc),
		teamId: row.teamId ?? null,
		lastSyncAt: iso(row.lastSyncAt),
		lastSyncStatus: (row.lastSyncStatus as CloudBillingSyncStatus | null) ?? null,
		lastSyncError: row.lastSyncError,
		lastSyncImported: row.lastSyncImported,
		lastSyncSkipped: row.lastSyncSkipped,
		createdById: row.createdById,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toRunRecord(row: {
	id: string;
	accountId: string;
	month: string;
	status: string;
	imported: number;
	skipped: number;
	errorMessage: string | null;
	startedAt: Date;
	finishedAt: Date | null;
}): CloudBillingSyncRunRecord {
	return {
		id: row.id,
		accountId: row.accountId,
		month: row.month,
		status: row.status as CloudBillingSyncStatus,
		imported: row.imported,
		skipped: row.skipped,
		errorMessage: row.errorMessage,
		startedAt: row.startedAt.toISOString(),
		finishedAt: iso(row.finishedAt),
	};
}

function currentMonthUtc(): string {
	return new Date().toISOString().slice(0, 7);
}

function sourceRefFor(accountId: string, externalId: string): string {
	// Keep under ~190 chars for unique index safety
	const raw = `${accountId}:${externalId}`;
	return raw.length <= 180 ? raw : `${raw.slice(0, 140)}:${tagValue(externalId).slice(0, 32)}`;
}

export async function createCloudBillingAccount(
	input: unknown,
	session?: SessionScope | null,
): Promise<CloudBillingAccountRecord> {
	const parsed = createCloudBillingAccountSchema.parse(input);
	const teamFromSession = session ? teamCreateData(session).teamId : undefined;
	const row = await prisma.cloudBillingAccount.create({
		data: {
			name: parsed.name,
			provider: parsed.provider,
			credentialsEnc: encryptCredentials(parsed.credentials ?? {}),
			config: (parsed.config ?? {}) as Prisma.InputJsonValue,
			currency: parsed.currency ?? DEFAULT_CURRENCY,
			enabled: parsed.enabled ?? true,
			teamId: parsed.teamId !== undefined ? parsed.teamId : (teamFromSession ?? null),
			createdById: session?.userId ?? null,
		},
	});
	return toAccountRecord(row);
}

export async function listCloudBillingAccounts(
	session?: SessionScope,
): Promise<CloudBillingAccountRecord[]> {
	const rows = await prisma.cloudBillingAccount.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
		take: 200,
	});
	return rows.map(toAccountRecord);
}

export async function getCloudBillingAccount(
	id: string,
	session?: SessionScope,
): Promise<CloudBillingAccountRecord> {
	const row = await prisma.cloudBillingAccount.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!row) throw new NotFoundError("Cloud billing account not found");
	return toAccountRecord(row);
}

export async function updateCloudBillingAccount(
	id: string,
	input: unknown,
	session?: SessionScope,
): Promise<CloudBillingAccountRecord> {
	const parsed = updateCloudBillingAccountSchema.parse(input);
	const existing = await prisma.cloudBillingAccount.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!existing) throw new NotFoundError("Cloud billing account not found");

	const data: Prisma.CloudBillingAccountUpdateInput = {};
	if (parsed.name !== undefined) data.name = parsed.name;
	if (parsed.currency !== undefined) data.currency = parsed.currency;
	if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
	if (parsed.config !== undefined) data.config = parsed.config as Prisma.InputJsonValue;
	if (parsed.teamId !== undefined) {
		data.team =
			parsed.teamId === null
				? { disconnect: true }
				: { connect: { id: parsed.teamId } };
	}
	if (parsed.credentials !== undefined) {
		const prev = decryptCredentials(existing.credentialsEnc);
		data.credentialsEnc = encryptCredentials({
			...prev,
			...parsed.credentials,
		});
	}

	const row = await prisma.cloudBillingAccount.update({ where: { id }, data });
	return toAccountRecord(row);
}

export async function deleteCloudBillingAccount(
	id: string,
	session?: SessionScope,
): Promise<void> {
	const deleted = await prisma.cloudBillingAccount.deleteMany({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (deleted.count === 0) throw new NotFoundError("Cloud billing account not found");
}

export interface CloudBillingSyncResult {
	run: CloudBillingSyncRunRecord;
	account: CloudBillingAccountRecord;
	imported: number;
	skipped: number;
	warnings: string[];
}

export async function syncCloudBillingAccount(
	accountId: string,
	month = currentMonthUtc(),
	session?: SessionScope,
): Promise<CloudBillingSyncResult> {
	const account = await prisma.cloudBillingAccount.findFirst({
		where: { id: accountId, ...(session ? teamWhere(session) : {}) },
	});
	if (!account) throw new NotFoundError("Cloud billing account not found");
	if (!account.enabled) {
		throw new ValidationError("Cloud billing account is disabled");
	}

	const run = await prisma.cloudBillingSyncRun.create({
		data: {
			accountId,
			month,
			status: "running",
		},
	});

	let imported = 0;
	let skipped = 0;
	let warnings: string[] = [];
	let status: CloudBillingSyncStatus = "ok";
	let errorMessage: string | null = null;

	try {
		const creds = decryptCredentials(account.credentialsEnc);
		const config = parseConfig(account.config);
		const fetched = await fetchCloudBillingItems({
			provider: account.provider as CloudBillingProvider,
			credentials: creds,
			config,
			month,
			currency: (account.currency as CostCurrency) || DEFAULT_CURRENCY,
		});
		warnings = fetched.warnings;

		for (const item of fetched.items) {
			if (!item.effectiveDate.startsWith(month)) {
				skipped += 1;
				continue;
			}
			const amountNum = Number(item.amount);
			if (!Number.isFinite(amountNum) || amountNum < 0) {
				skipped += 1;
				continue;
			}
			const sourceRef = sourceRefFor(accountId, item.externalId);
			const effectiveDate = new Date(`${item.effectiveDate}T00:00:00Z`);
			const tags = [
				`source:${SOURCE_TYPE}`,
				`category:${item.category}`,
				`provider:${tagValue(item.providerLabel)}`,
				`account:${tagValue(accountId)}`,
				...(item.productCode ? [`product:${tagValue(item.productCode)}`] : []),
				...(item.tags ?? []).map((t) => tagValue(t)),
			];
			await prisma.costEntry.upsert({
				where: {
					sourceType_sourceRef_effectiveDate: {
						sourceType: SOURCE_TYPE,
						sourceRef,
						effectiveDate,
					},
				},
				create: {
					category: item.category,
					provider: item.providerLabel.slice(0, 128),
					amount: new Prisma.Decimal(amountNum.toFixed(2)),
					currency: item.currency,
					effectiveDate,
					notes: item.notes ?? `Cloud billing import ${account.name} ${month}`,
					sourceType: SOURCE_TYPE,
					sourceRef,
					createdById: account.createdById,
					teamId: account.teamId ?? null,
					tags,
				},
				update: {
					category: item.category,
					provider: item.providerLabel.slice(0, 128),
					amount: new Prisma.Decimal(amountNum.toFixed(2)),
					currency: item.currency,
					notes: item.notes ?? `Cloud billing import ${account.name} ${month}`,
					teamId: account.teamId ?? null,
					tags,
				},
			});
			imported += 1;
		}

		if (warnings.length > 0 && imported === 0) {
			status = "partial";
		}
	} catch (err) {
		status = "error";
		errorMessage = err instanceof Error ? err.message : String(err);
		logger.warn("cloud billing sync failed", {
			accountId,
			month,
			error: errorMessage,
		});
	}

	const finishedAt = new Date();
	const updatedRun = await prisma.cloudBillingSyncRun.update({
		where: { id: run.id },
		data: {
			status,
			imported,
			skipped,
			errorMessage,
			finishedAt,
		},
	});

	const updatedAccount = await prisma.cloudBillingAccount.update({
		where: { id: accountId },
		data: {
			lastSyncAt: finishedAt,
			lastSyncStatus: status,
			lastSyncError: errorMessage,
			lastSyncImported: imported,
			lastSyncSkipped: skipped,
		},
	});

	if (status === "error") {
		// Do not throw after recording — caller can inspect run.status.
		// But for API UX we rethrow so route returns 400/502 with message.
		throw new ValidationError(errorMessage ?? "Cloud billing sync failed");
	}

	return {
		run: toRunRecord(updatedRun),
		account: toAccountRecord(updatedAccount),
		imported,
		skipped,
		warnings,
	};
}

export async function listCloudBillingSyncRuns(
	accountId: string,
	limit = 20,
	session?: SessionScope,
): Promise<CloudBillingSyncRunRecord[]> {
	const account = await prisma.cloudBillingAccount.findFirst({
		where: { id: accountId, ...(session ? teamWhere(session) : {}) },
		select: { id: true },
	});
	if (!account) throw new NotFoundError("Cloud billing account not found");
	const rows = await prisma.cloudBillingSyncRun.findMany({
		where: { accountId },
		orderBy: { startedAt: "desc" },
		take: Math.min(Math.max(limit, 1), 100),
	});
	return rows.map(toRunRecord);
}
