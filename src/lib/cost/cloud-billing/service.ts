/**
 * Cloud billing account service (FEAT-COST-CLOUD-BILLING).
 *
 * - Credentials encrypted at rest (AES-256-GCM via encrypt/decrypt)
 * - Sync upserts CostEntry rows with sourceType=cloud_billing
 * - Unique key: sourceType + sourceRef + effectiveDate
 *   sourceRef = `${accountId}:${externalId}`; over-long values keep a prefix plus
 *   a SHA-256 digest of the full value, so distinct items never collide
 * - One import per account+month at a time (advisory lock): two concurrent runs
 *   upsert the same unique keys and race each other's counters
 * - Team scope via teamWhere / teamCreateData (multi-tenant)
 */
import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { decryptJsonCredentials, encryptJsonCredentials } from "@/lib/crypto/json-credentials";
import { currentCopyLocale } from "@/lib/i18n/api-copy";
import { costMessage } from "../messages";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";

import type { CostCurrency } from "../types";
import { tagValue } from "../service-internals";
import { csvNaturalKeyPrefix, fetchCloudBillingItems } from "./adapters";
import {
	createCloudBillingAccountSchema,
	updateCloudBillingAccountSchema,
} from "./schema";
import { t } from "@/lib/i18n/service-translations";
import { isCalendarDate } from "../calendar-date";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import type {
	BillingRowIssue,
	CloudBillingAccountConfig,
	CloudBillingAccountRecord,
	CloudBillingCredentials,
	CloudBillingLineItem,
	CloudBillingProvider,
	CloudBillingSyncRunRecord,
	CloudBillingSyncStatus,
} from "./types";

const logger = createLogger("cloud-billing");
const DEFAULT_CURRENCY: CostCurrency = "USD";
const SOURCE_TYPE = "cloud_billing";
const NATURAL_ORDINAL_TAG = "csv-ordinal:v2";

type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

function iso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

function parseConfig(raw: Prisma.JsonValue | null | undefined): CloudBillingAccountConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return raw as CloudBillingAccountConfig;
}

function encryptCredentials(creds: CloudBillingCredentials): string {
	return encryptJsonCredentials(creds);
}

function decryptCredentials(enc: string): CloudBillingCredentials {
	return decryptJsonCredentials<CloudBillingCredentials>(enc, t("backend.cost.storedCloudBillingCredentialsAreCorrupt"));
}

// Older accounts contain free-form errors. Only validated fields from a new
// diagnostic can contribute to a reader's summary.
function accountDiagnostic(raw: string | null) {
	if (raw?.startsWith("billing:v1:")) {
		try {
			const { detail, issues } = JSON.parse(raw.slice("billing:v1:".length));
			if (typeof detail === "string" && Array.isArray(issues)) {
				const safe: BillingRowIssue[] = [];
				for (const issue of issues.slice(0, 20)) {
					if (Number.isSafeInteger(issue?.row) && issue.row > 0 && (issue.reason === "date" || issue.reason === "amount")) {
						safe.push({ row: issue.row, reason: issue.reason });
					}
				}
				return { lastSyncError: detail, lastSyncIssues: safe };
			}
		} catch { /* Legacy, unstructured detail. */ }
	}
	return { lastSyncError: raw };
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
		...accountDiagnostic(row.lastSyncError),
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

function currentAppMonth(): string {
	// Application time, as budgets read it.
	return appTimeZoneDateKey().slice(0, 7);
}

function sourceRefFor(accountId: string, externalId: string): string {
	// Keep under ~190 chars for unique index safety.
	const raw = `${accountId}:${externalId}`;
	if (raw.length <= 180) return raw;
	// The old fallback appended a *truncated, lowercased* slice of the same
	// externalId, so two long ids sharing a 140-char prefix and a 32-char tail
	// produced the same sourceRef — their cost entries then upserted over each
	// other and one line item silently vanished from the month's total. A digest
	// of the full value cannot collide that way.
	const digest = createHash("sha256").update(raw).digest("hex").slice(0, 32);
	return `${raw.slice(0, 140)}:${digest}`;
}

export async function createCloudBillingAccount(
	input: unknown,
	session?: SessionScope | null,
): Promise<CloudBillingAccountRecord> {
	const parsed = createCloudBillingAccountSchema.parse(input);
	// Team scope is session-derived only — never accept body teamId (IDOR/tenant spoof).
	const teamId = session ? (teamCreateData(session).teamId ?? null) : null;
	const row = await prisma.cloudBillingAccount.create({
		data: {
			name: parsed.name,
			provider: parsed.provider,
			credentialsEnc: encryptCredentials(parsed.credentials ?? {}),
			config: (parsed.config ?? {}) as Prisma.InputJsonValue,
			currency: parsed.currency ?? DEFAULT_CURRENCY,
			enabled: parsed.enabled ?? true,
			teamId,
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
	if (!row) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));
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
	if (!existing) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));

	const data: Prisma.CloudBillingAccountUpdateInput = {};
	if (parsed.name !== undefined) data.name = parsed.name;
	if (parsed.currency !== undefined) data.currency = parsed.currency;
	if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
	if (parsed.config !== undefined) data.config = parsed.config as Prisma.InputJsonValue;
	// Ignore body teamId — reassignment would let cost:manage users move accounts
	// into another tenant or null-shared scope (cross-team credential/cost IDOR).
	if (parsed.credentials !== undefined) {
		const prev = decryptCredentials(existing.credentialsEnc);
		data.credentialsEnc = encryptCredentials({
			...prev,
			...parsed.credentials,
		});
	}

	const claimed = await prisma.cloudBillingAccount.updateMany({
		where: { id, ...(session ? teamWhere(session) : {}), updatedAt: existing.updatedAt,
			...(parsed.credentials !== undefined ? { credentialsEnc: existing.credentialsEnc } : {}) },
		data,
	});
	if (!claimed.count) {
		await getCloudBillingAccount(id, session);
		throw new ConflictError(costMessage("accountChanged", currentCopyLocale()));
	}
	const row = await prisma.cloudBillingAccount.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!row) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));
	return toAccountRecord(row);
}

export async function deleteCloudBillingAccount(
	id: string,
	session?: SessionScope,
): Promise<void> {
	const deleted = await prisma.cloudBillingAccount.deleteMany({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (deleted.count === 0) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));
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
	month = currentAppMonth(),
	session?: SessionScope,
	confirmLegacyDuplicates = false,
): Promise<CloudBillingSyncResult> {
	// Serialize per account+month. Two concurrent imports upsert the same
	// (sourceType, sourceRef, effectiveDate) keys and then both write
	// lastSync* on the account, so the surviving counters describe neither run.
	const releaseLock = await acquireAdvisoryLock("cloud-billing-sync", `${accountId}:${month}`);
	try {
		return await runCloudBillingSync(accountId, month, session, confirmLegacyDuplicates);
	} finally {
		await releaseLock();
	}
}

async function migrateMixedCsvGroups(tx: Prisma.TransactionClient, accountId: string, teamId: string | null,
	items: CloudBillingLineItem[], incomplete: boolean, confirmDuplicates: boolean) {
	const groups = new Map<string, { explicit: string[]; natural: CloudBillingLineItem[] }>();
	for (const item of items) {
		if (!item.productCode || !item.externalId.startsWith("csv:")) continue;
		const prefix = `${accountId}:${csvNaturalKeyPrefix(item.effectiveDate, item.productCode)}`;
		const group = groups.get(prefix) ?? { explicit: [], natural: [] };
		if (item.externalId.startsWith("csv:id:")) group.explicit.push(sourceRefFor(accountId, item.externalId));
		else group.natural.push(item);
		groups.set(prefix, group);
	}
	for (const [prefix, { explicit, natural }] of groups) {
		if (!explicit.length || !natural.length) continue;
		const where = { sourceType: SOURCE_TYPE, teamId, effectiveDate: new Date(natural[0]!.effectiveDate), sourceRef: { startsWith: prefix } };
		const existing = await tx.costEntry.findMany({ where, orderBy: { sourceRef: "asc" } });
		const ordinals = existing.map(row => Number(row.sourceRef?.slice(prefix.length)));
		if (!existing.some((row, i) => !row.tags.includes(NATURAL_ORDINAL_TAG) && ordinals[i]! > natural.length)) continue;

		const review = () => new ConflictError(costMessage("reviewCsv", currentCopyLocale()));
		if (incomplete || ordinals.some(n => !Number.isSafeInteger(n) || n < 1 || n > natural.length + explicit.length)) throw review();
		const knownIds = await tx.costEntry.count({ where: { ...where, sourceRef: { in: explicit } } });
		if (knownIds !== explicit.length) throw review();

		// Match amounts and dimensions before changing identities. Old and new
		// ordinals can overlap, so first vacate all displaced keys in this transaction.
		const matches = (row: typeof existing[number], item: CloudBillingLineItem) =>
			row.currency === item.currency && row.provider === item.providerLabel.slice(0, 128)
			&& row.amount.equals(item.amount) && row.category === item.category && (!item.notes || row.notes === item.notes);
		const available = new Set(existing);
		const assigned = new Map<CloudBillingLineItem, typeof existing[number]>();
		for (const item of natural) {
			const ref = sourceRefFor(accountId, item.externalId);
			const row = existing.find(r => r.sourceRef === ref && matches(r, item));
			if (row) { assigned.set(item, row); available.delete(row); }
		}
		for (const item of natural) {
			if (assigned.has(item)) continue;
			const row = [...available].find(r => matches(r, item));
			if (row) { assigned.set(item, row); available.delete(row); }
		}
		for (const row of available) {
			const duplicate = [...assigned].find(([item]) => matches(row, item));
			// Earlier imports supported partial CSVs. Even identical amounts may be
			// separate charges missing from this export. Deletion requires the
			// manager to attest that the complete original bill was checked.
			if (!duplicate || !confirmDuplicates || row.tags.includes(NATURAL_ORDINAL_TAG)) throw review();
			const priorTag = `adjustment-for:${row.id}`;
			const nextTag = `adjustment-for:${duplicate[1].id}`;
			await tx.$executeRaw`UPDATE cost_entries SET tags = array_replace(tags, ${priorTag}, ${nextTag})
				WHERE "teamId" IS NOT DISTINCT FROM ${teamId} AND ${priorTag} = ANY(tags)`;
			await tx.costEntry.delete({ where: { id: row.id } });
		}
		const moves = [...assigned].filter(([item, row]) => row.sourceRef !== sourceRefFor(accountId, item.externalId));
		for (const [, row] of moves) {
			await tx.costEntry.update({ where: { id: row.id }, data: { sourceRef: `${accountId}:migration:${row.id}` } });
		}
		for (const [item, row] of moves) {
			await tx.costEntry.update({ where: { id: row.id }, data: { sourceRef: sourceRefFor(accountId, item.externalId) } });
		}
	}
}

async function runCloudBillingSync(
	accountId: string,
	month: string,
	session: SessionScope | undefined,
	confirmLegacyDuplicates: boolean,
): Promise<CloudBillingSyncResult> {
	const account = await prisma.cloudBillingAccount.findFirst({
		where: { id: accountId, ...(session ? teamWhere(session) : {}) },
	});
	if (!account) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));

	// Holding the account/month lock proves any earlier running writer has gone.
	const scope = { id: accountId, ...(session ? teamWhere(session) : {}) };
	const run = await prisma.$transaction(async (tx) => {
		const finishedAt = new Date();
		const errorMessage = costMessage("interrupted", currentCopyLocale());
		const stale = await tx.cloudBillingSyncRun.updateMany({
			where: { accountId, month, status: "running" },
			data: { status: "error", finishedAt, errorMessage },
		});
		if (!account.enabled) {
			if (stale.count) await tx.cloudBillingAccount.update({ where: scope, data: {
				lastSyncAt: finishedAt, lastSyncStatus: "error", lastSyncError: errorMessage, lastSyncImported: 0, lastSyncSkipped: 0,
			} });
			return null;
		}
		return tx.cloudBillingSyncRun.create({ data: { accountId, month, status: "running" } });
	});
	if (!run) throw new ValidationError(t("backend.cost.cloudBillingAccountIsDisabled"));
	const finish = async (tx: Prisma.TransactionClient, status: CloudBillingSyncStatus, imported: number,
		skipped: number, errorMessage: string | null, issues: BillingRowIssue[] = []) => {
		const finishedAt = new Date();
		const [savedRun] = await tx.cloudBillingSyncRun.updateManyAndReturn({
			where: { id: run.id, status: "running" }, data: { status, imported, skipped, errorMessage, finishedAt },
		});
		// A recovered run no longer owns publication. This also keeps an
		// ambiguous commit acknowledgement from relabelling a committed batch.
		if (!savedRun) return null;
		const savedAccount = await tx.cloudBillingAccount.update({
			where: scope,
			data: { lastSyncAt: finishedAt, lastSyncStatus: status, lastSyncImported: imported, lastSyncSkipped: skipped,
				lastSyncError: errorMessage && issues.length ? `billing:v1:${JSON.stringify({ detail: errorMessage, issues })}` : errorMessage },
		});
		return { run: toRunRecord(savedRun), account: toAccountRecord(savedAccount), imported, skipped };
	};

	let skipped = 0;
	let warnings: string[] = [];

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
		skipped += fetched.rejectedRows ?? 0;
		let invalidDates = 0;
		// For a line the file gives no note: where the entry came from.
		const importNote = t("backend.cost.cloudBillingImportNote", { account: account.name, month });

		// Check the full batch against the database's unique key before the first upsert.
		const entries = new Map<string, { item: CloudBillingLineItem; sourceRef: string }>();
		for (const item of fetched.items) {
			// An impossible day would roll into the next month once stored.
			if (!isCalendarDate(item.effectiveDate)) {
				skipped += 1;
				invalidDates += 1;
				warnings = [...warnings, t("backend.cost.invalidBillingDate", { date: item.effectiveDate })];
				continue;
			}
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
			const key = `${item.effectiveDate}:${sourceRef}`;
			if (entries.has(key)) {
				throw new ValidationError(t("backend.cost.duplicateBillingLine", {
					date: item.effectiveDate,
					id: item.externalId.slice(0, 180),
				}));
			}
			entries.set(key, { item, sourceRef });
		}

		const result = await prisma.$transaction(async (tx) => {
			await migrateMixedCsvGroups(tx, accountId, account.teamId, Array.from(entries.values(), entry => entry.item), skipped > 0, confirmLegacyDuplicates);
			for (const { item, sourceRef } of entries.values()) {
				const effectiveDate = new Date(`${item.effectiveDate}T00:00:00Z`);
				const tags = [
					`source:${SOURCE_TYPE}`,
					...(item.externalId.startsWith("csv:natural:") ? [NATURAL_ORDINAL_TAG] : []),
					`category:${item.category}`,
					`provider:${tagValue(item.providerLabel)}`,
					`account:${tagValue(accountId)}`,
					...(item.productCode ? [`product:${tagValue(item.productCode)}`] : []),
					...(item.tags ?? []).map((t) => tagValue(t)),
				];
				await tx.costEntry.upsert({
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
						amount: new Prisma.Decimal(item.amount),
						currency: item.currency,
						effectiveDate,
						notes: item.notes ?? importNote,
						sourceType: SOURCE_TYPE,
						sourceRef,
						createdById: account.createdById,
						teamId: account.teamId ?? null,
						tags,
					},
					update: {
						category: item.category,
						provider: item.providerLabel.slice(0, 128),
						amount: new Prisma.Decimal(item.amount),
						currency: item.currency,
						notes: item.notes ?? importNote,
						teamId: account.teamId ?? null,
						tags,
					},
				});
			}
			const partial = (warnings.length > 0 && !entries.size) || Boolean(fetched.rejectedRows) || invalidDates > 0;
			const published = await finish(tx, partial ? "partial" : "ok", entries.size, skipped,
				partial ? warnings.join("; ").slice(0, 1000) || null : null, fetched.rowIssues);
			if (!published) throw new ConflictError(costMessage("interrupted", currentCopyLocale()));
			return published;
		}, { timeout: 120_000 });
		return { ...result, warnings };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await prisma.$transaction((tx) => finish(tx, "error", 0, skipped, message));
		logger.warn("cloud billing sync failed", { accountId, month, error: message });
		if (err instanceof ConflictError) throw err;
		throw new ValidationError(message);
	}
}
