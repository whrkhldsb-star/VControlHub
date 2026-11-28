/**
 * Server-side loader for Command & AI Approval Policy settings.
 *
 * - Short TTL (5 s) for interactive reads, plus `fresh: true` option to read
 *   directly from the database inside critical creation transactions.
 * - Immediately invalidated in-process via `invalidateApprovalPolicyCache()`
 *   from `rememberSaved` in `src/lib/settings/service.ts`.
 * - Distinguishes:
 *   - missing row (unset) -> documented default (`DEFAULT_APPROVAL_POLICIES`)
 *   - invalid stored value or DB read error -> fail-closed (`FAIL_CLOSED_APPROVAL_POLICIES`)
 *   - unit test mock without `prisma.setting.findMany` -> documented defaults
 */
import { prisma } from "@/lib/db";
import {
  DEFAULT_APPROVAL_POLICIES,
  FAIL_CLOSED_APPROVAL_POLICIES,
  type ApprovalPolicyMode,
  type ApprovalPolicySnapshot,
  type MaxAiAutomationMode,
  type ScopedApprovalPolicyMode,
  type SelfReviewPolicy,
} from "./approval-policy";

export const APPROVAL_POLICY_SETTING_KEYS = [
  "command.approvalPolicy",
  "ai.commandApprovalPolicy",
  "deploy.approvalPolicy",
  "command.selfReview",
  "ai.maxAutomationMode",
  "ai.fullAutoAllowCritical",
] as const;

export type ApprovalPolicySettingKey = (typeof APPROVAL_POLICY_SETTING_KEYS)[number];

const CACHE_TTL_MS = 5_000;

let cached: { value: ApprovalPolicySnapshot; loadedAt: number } | null = null;
let inflight: Promise<ApprovalPolicySnapshot> | null = null;
let generation = 0;

function parsePolicy(raw: string | undefined, fallback: ApprovalPolicyMode, failClosed: ApprovalPolicyMode): ApprovalPolicyMode {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "always" || raw === "high_risk" || raw === "never") return raw;
  return failClosed;
}

function parseScopedPolicy(
  raw: string | undefined,
  fallback: ScopedApprovalPolicyMode,
  failClosed: ScopedApprovalPolicyMode,
): ScopedApprovalPolicyMode {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "inherit" || raw === "always" || raw === "high_risk" || raw === "never") return raw;
  return failClosed;
}

function parseSelfReview(raw: string | undefined): SelfReviewPolicy {
  if (raw === undefined || raw === "") return DEFAULT_APPROVAL_POLICIES.commandSelfReview;
  if (raw === "platform_admins" || raw === "approvers") return raw;
  return FAIL_CLOSED_APPROVAL_POLICIES.commandSelfReview;
}

function parseMaxMode(raw: string | undefined): MaxAiAutomationMode {
  if (raw === undefined || raw === "") return DEFAULT_APPROVAL_POLICIES.aiMaxAutomationMode;
  if (raw === "plan" || raw === "confirm" || raw === "auto" || raw === "full_auto") return raw;
  return FAIL_CLOSED_APPROVAL_POLICIES.aiMaxAutomationMode;
}

function parseBool(raw: string | undefined, fallback: boolean, failClosed: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return failClosed;
}

function parseSnapshotFromMap(map: Map<string, string>): ApprovalPolicySnapshot {
  return {
    commandApprovalPolicy: parsePolicy(
      map.get("command.approvalPolicy"),
      DEFAULT_APPROVAL_POLICIES.commandApprovalPolicy,
      FAIL_CLOSED_APPROVAL_POLICIES.commandApprovalPolicy,
    ),
    aiCommandApprovalPolicy: parseScopedPolicy(
      map.get("ai.commandApprovalPolicy"),
      DEFAULT_APPROVAL_POLICIES.aiCommandApprovalPolicy,
      FAIL_CLOSED_APPROVAL_POLICIES.aiCommandApprovalPolicy,
    ),
    deployApprovalPolicy: parseScopedPolicy(
      map.get("deploy.approvalPolicy"),
      DEFAULT_APPROVAL_POLICIES.deployApprovalPolicy,
      FAIL_CLOSED_APPROVAL_POLICIES.deployApprovalPolicy,
    ),
    commandSelfReview: parseSelfReview(map.get("command.selfReview")),
    aiMaxAutomationMode: parseMaxMode(map.get("ai.maxAutomationMode")),
    aiFullAutoAllowCritical: parseBool(
      map.get("ai.fullAutoAllowCritical"),
      DEFAULT_APPROVAL_POLICIES.aiFullAutoAllowCritical,
      FAIL_CLOSED_APPROVAL_POLICIES.aiFullAutoAllowCritical,
    ),
  };
}

async function readPoliciesFromDb(): Promise<ApprovalPolicySnapshot> {
  const started = generation;
  const delegate = (prisma as unknown as {
    setting?: {
      findMany?: (args: {
        where: { key: { in: string[] } };
        select: { key: true; value: true };
      }) => Promise<Array<{ key: string; value: string }>>;
    };
  }).setting;
  if (!delegate?.findMany) {
    return { ...DEFAULT_APPROVAL_POLICIES };
  }
  try {
    const rows = await delegate.findMany({
      where: { key: { in: [...APPROVAL_POLICY_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
    if (!Array.isArray(rows)) {
      return { ...DEFAULT_APPROVAL_POLICIES };
    }
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row && typeof row.key === "string" && typeof row.value === "string") {
        map.set(row.key, row.value.trim());
      }
    }
    const snapshot = parseSnapshotFromMap(map);
    if (started === generation) {
      cached = { value: snapshot, loadedAt: Date.now() };
    }
    return snapshot;
  } catch {
    return { ...FAIL_CLOSED_APPROVAL_POLICIES };
  }
}

export async function getApprovalPolicySettings(options?: { fresh?: boolean }): Promise<ApprovalPolicySnapshot> {
  if (options?.fresh) {
    return readPoliciesFromDb();
  }
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  if (!inflight) {
    const started = generation;
    const promise = readPoliciesFromDb().finally(() => {
      if (inflight === promise) {
        inflight = null;
      }
    });
    if (started === generation) {
      inflight = promise;
    }
    return promise;
  }
  return inflight;
}

export function invalidateApprovalPolicyCache(): void {
  generation += 1;
  cached = null;
  inflight = null;
}

export function isApprovalPolicySettingKey(key: string): key is ApprovalPolicySettingKey {
  return (APPROVAL_POLICY_SETTING_KEYS as readonly string[]).includes(key);
}
