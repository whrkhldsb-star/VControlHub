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
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";

import type { CostCurrency } from "../types";
import { endOfMonthUtc, startOfMonthUtc, tagValue } from "../service-internals";
import { csvNaturalKeyPrefix, fetchCloudBillingItems } from "./adapters";
import {
	billingSourceSchema,
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

	if (existing.provider === "generic_csv" && (parsed.config !== undefined || (parsed.enabled ?? existing.enabled))) {
		billingSourceSchema.parse({ provider: existing.provider, config: parsed.config ?? existing.config });
	}
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
	// Verify account existence and caller team scope before pinning an advisory-lock connection.
	const precheck = await prisma.cloudBillingAccount.findFirst({
		where: { id: accountId, ...(session ? teamWhere(session) : {}) },
		select: { id: true },
	});
	if (!precheck) throw new NotFoundError(t("backend.cost.cloudBillingAccountNotFound"));
	// Serialize per account+month. Two concurrent imports upsert the same
	// (sourceType, sourceRef, effectiveDate) keys and then both write
	// lastSync* on the account, so the surviving counters describe neither run.
	const releaseLock = await acquireAdvisoryLock("cloud-billing-sync", `${accountId}:${month}`, { timeoutMs: 5_000 });
	try {
		return await runCloudBillingSync(accountId, month, session, confirmLegacyDuplicates);
	} finally {
		await releaseLock();
	}
}

type ImportLine = { item: CloudBillingLineItem; sourceRef: string };
const FRACTIONAL_TAG = "csv-fractional-cent";

async function reconcileCsv(tx: Prisma.TransactionClient, accountId: string, teamId: string | null, month: string,
	lines: ImportLine[], incomplete: boolean, confirmDuplicates: boolean) {
	if (!lines.some(({ item }) => item.externalId.startsWith("csv:"))) return;
	const existing = await tx.costEntry.findMany({ where: { sourceType: SOURCE_TYPE, teamId,
		effectiveDate: { gte: startOfMonthUtc(month), lt: endOfMonthUtc(month) }, sourceRef: { startsWith: escapeLikeLiteral(accountId + ":") } } });
	const key = (date: string, ref: string) => date + "|" + ref;
	const byKey = new Map(existing.map(row => [key(row.effectiveDate.toISOString().slice(0, 10), row.sourceRef!), row]));
	const wanted = new Set(lines.map(({ item, sourceRef }) => key(item.effectiveDate, sourceRef)));
	const review = () => new ConflictError(costMessage("reviewCsv", currentCopyLocale()));
	const matches = (row: typeof existing[number], item: CloudBillingLineItem) =>
		row.currency === item.currency && row.provider === item.providerLabel.slice(0, 128)
		&& row.amount.equals(item.amount) && row.category === item.category && (!item.notes || row.notes === item.notes);
	const consumed = new Set<string>();
	const moves = new Map<string, string>();
	const aliases = new Set<string>();
	for (const { item, sourceRef } of lines) {
		if (!item.legacyExternalId) continue;
		const oldKey = key(item.effectiveDate, sourceRefFor(accountId, item.legacyExternalId));
		const prior = byKey.get(oldKey);
		if (!prior) continue;
		if (aliases.has(oldKey) || wanted.has(oldKey)) throw review();
		aliases.add(oldKey);
		if (byKey.has(key(item.effectiveDate, sourceRef)) || !matches(prior, item)) throw review();
		moves.set(prior.id, sourceRef);
		consumed.add(prior.id);
	}

	const naturalGroups = new Map<string, ImportLine[]>();
	for (const line of lines) {
		if (!line.item.externalId.startsWith("csv:natural:")) continue;
		const prefix = accountId + ":" + csvNaturalKeyPrefix(line.item.effectiveDate, line.item.productCode!);
		const group = naturalGroups.get(prefix) ?? [];
		group.push(line);
		naturalGroups.set(prefix, group);
	}
	const existingGroups = new Map<string, typeof existing>();
	for (const row of existing) {
		if (!row.sourceRef || consumed.has(row.id)) continue;
		const prefix = row.sourceRef.slice(0, row.sourceRef.lastIndexOf(":") + 1);
		if (!naturalGroups.has(prefix)) continue;
		const rows = existingGroups.get(prefix) ?? [];
		rows.push(row);
		existingGroups.set(prefix, rows);
	}
	const aliasTargets = new Set(moves.values());
	const removed = new Set<string>();
	for (const [prefix, group] of naturalGroups) {
		const rows = existingGroups.get(prefix) ?? [];
		if (!rows.length) continue;
		const remaining = new Set(rows);
		const removedBefore = removed.size;
		const partial = rows.length > group.length;
		const assigned: { line: ImportLine; row: typeof rows[number] }[] = [];
		for (const line of group) {
			if (aliasTargets.has(line.sourceRef)) continue;
			const candidates = [...remaining].filter(row => matches(row, line.item));
			const sameKey = candidates.find(row => row.sourceRef === line.sourceRef);
			const unchanged = !partial && sameKey?.tags.includes(NATURAL_ORDINAL_TAG);
			const row = candidates.length === 1 ? candidates[0] : unchanged ? sameKey
				: confirmDuplicates && sameKey && !incomplete ? sameKey : undefined;
			if (candidates.length && !row) throw review();
			if (row) {
				assigned.push({ line, row });
				remaining.delete(row);
			}
		}
		// A single stable natural line can be corrected. For repeated charges
		// an ordinal from a partial export cannot identify a changed line.
		if (remaining.size && rows.length === 1 && group.length === 1 && rows[0]!.sourceRef === group[0]!.sourceRef
			&& rows[0]!.tags.includes(NATURAL_ORDINAL_TAG)) remaining.clear();
		if (partial && assigned.length !== group.length) throw review();
		for (const row of remaining) {
			const duplicates = assigned.filter(({ line }) => matches(row, line.item));
			const duplicate = duplicates[0];
			if (!duplicate && partial) continue;
			if (!confirmDuplicates || incomplete || duplicates.length !== 1 || !duplicate || row.tags.includes(NATURAL_ORDINAL_TAG)) {
				throw review();
			}
			const sameProduct = lines.filter(({ item }) => item.effectiveDate === duplicate.line.item.effectiveDate
				&& item.productCode === duplicate.line.item.productCode && item.externalId.startsWith("csv:id:"));
			if (Number(row.sourceRef!.slice(prefix.length)) > group.length + sameProduct.length) throw review();
			if (!sameProduct.length || sameProduct.some(({ item, sourceRef }) => !byKey.has(key(item.effectiveDate, sourceRef)))) throw review();
			const explicitRefs = new Set(sameProduct.map(line => line.sourceRef));
			if (existing.some(other => +other.effectiveDate === +row.effectiveDate && other.provider === row.provider &&
				other.sourceRef?.startsWith(accountId + ":csv:id:") && !explicitRefs.has(other.sourceRef))) throw review();
			await tx.$queryRaw`SELECT id FROM cost_entries WHERE id = ${row.id} FOR UPDATE`;
			await tx.$executeRaw`UPDATE cost_entries SET tags = array_replace(tags, ${"adjustment-for:" + row.id}, ${"adjustment-for:" + duplicate.row.id})
				WHERE ${"adjustment-for:" + row.id} = ANY(tags)`;
			await tx.costEntry.delete({ where: { id: row.id } });
			removed.add(row.id);
		}
		for (const { line, row } of assigned) {
			if (partial && removed.size === removedBefore) line.sourceRef = row.sourceRef!;
			else if (line.sourceRef !== row.sourceRef) moves.set(row.id, line.sourceRef);
		}
	}
	// Decimal(12,2) retains only the allocation. Recomputing a fractional
	// currency bucket requires every stored line in that month's bucket.
	const touched = new Set(lines.map(({ item }) => item.currency as string));
	const fractions = new Set(lines.filter(({ item }) => item.fractionalCent).map(({ item }) => item.currency as string));
	const resolved = new Set(lines.map(({ item, sourceRef }) => key(item.effectiveDate, sourceRef)));
	const storedKey = (row: typeof existing[number]) => key(row.effectiveDate.toISOString().slice(0, 10), moves.get(row.id) ?? row.sourceRef!);
	// A correction can move a charge between currencies. Recompute both buckets.
	for (const row of existing) if (resolved.has(storedKey(row))) touched.add(row.currency);
	for (const row of existing) if (touched.has(row.currency) && row.tags.includes(FRACTIONAL_TAG)) fractions.add(row.currency);
	if (resolved.size !== lines.length || (incomplete && moves.size)) throw review();
	if (fractions.size && (incomplete || existing.some(row => fractions.has(row.currency) && !removed.has(row.id)
		&& !resolved.has(storedKey(row))))) {
		throw new ConflictError(costMessage("fractionalCsv", currentCopyLocale()));
	}
	for (const [id] of moves) await tx.costEntry.update({ where: { id }, data: { sourceRef: `${accountId}:migration:${id}` } });
	for (const [id, sourceRef] of moves) await tx.costEntry.update({ where: { id }, data: { sourceRef } });
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
			await reconcileCsv(tx, accountId, account.teamId, month, [...entries.values()], skipped > 0, confirmLegacyDuplicates);
			for (const { item, sourceRef } of entries.values()) {
				const effectiveDate = new Date(`${item.effectiveDate}T00:00:00Z`);
				const tags = [
					`source:${SOURCE_TYPE}`,
					...(item.fractionalCent ? [FRACTIONAL_TAG] : []),
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
