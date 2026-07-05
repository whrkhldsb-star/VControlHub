"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { reviewCommandRequest } from "@/lib/command/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export type ReviewActionState = {
  error?: string;
  success?: string;
};

export type BatchReviewActionState = {
  error?: string;
  success?: string;
  /** Per-id outcome map for fine-grained UI feedback (id → "ok" | error msg). */
  results?: Record<string, "ok" | string>;
};

export async function reviewCommandAction(_prevState: ReviewActionState | null, formData: FormData) {
  const session = await requirePermission("command:approve");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);

  try {
    const approved = String(formData.get("decision") ?? "approve") === "approve";
    const commandRequestId = String(formData.get("commandRequestId") ?? "");
    const comment = String(formData.get("comment") ?? "");

    await reviewCommandRequest({
      commandRequestId,
      approverId: session.userId,
      approved,
      comment,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/requests");

    return {
      success: approved ? tr("requestsPage.action.approved") : tr("requestsPage.action.rejected"),
    } satisfies ReviewActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : tr("requestsPage.action.reviewFailed") } satisfies ReviewActionState;
  }
}

/**
 * Batch approve / reject multiple command requests in one server action.
 *
 * FormData shape:
 *   - decision: "approve" | "reject"
 *   - comment: optional shared comment applied to every reviewed request
 *   - commandRequestId: repeated field — one entry per selected request
 *
 * Strategy: per-request try/catch so a single failure (e.g. race condition
 * where another reviewer already actioned the request) doesn't block the
 * rest. Returns a per-id result map plus an aggregate summary string.
 *
 * Performance: sequential await loop on purpose — the underlying service
 * touches Prisma + execution-queue writes that aren't safe to parallelize
 * yet. Batch size is bounded by the UI selection (one page of pending).
 */
export async function batchReviewCommandAction(
  _prevState: BatchReviewActionState | null,
  formData: FormData,
): Promise<BatchReviewActionState> {
  const session = await requirePermission("command:approve");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);

  const approved = String(formData.get("decision") ?? "approve") === "approve";
  const comment = String(formData.get("comment") ?? "");
  const rawIds = formData.getAll("commandRequestId");
  const ids = Array.from(
    new Set(rawIds.map((v) => String(v ?? "").trim()).filter((s) => s.length > 0)),
  );

  if (ids.length === 0) {
    return { error: tr("requestsPage.batch.errorNoSelection") } satisfies BatchReviewActionState;
  }

  const results: Record<string, "ok" | string> = {};
  let okCount = 0;
  let failCount = 0;

  for (const commandRequestId of ids) {
    try {
      await reviewCommandRequest({
        commandRequestId,
        approverId: session.userId,
        approved,
        comment,
      });
      results[commandRequestId] = "ok";
      okCount++;
    } catch (error) {
      results[commandRequestId] = error instanceof Error ? error.message : tr("requestsPage.batch.errorReviewFailed");
      failCount++;
    }
  }

  revalidatePath("/");
  revalidatePath("/servers");
  revalidatePath("/requests");

  const verb = approved ? tr("requestsPage.batch.verbApprove") : tr("requestsPage.batch.verbReject");
  if (failCount === 0) {
    return {
      success: tr("requestsPage.batch.successAll").replace("{verb}", verb).replace("{count}", String(okCount)),
      results,
    } satisfies BatchReviewActionState;
  }
  if (okCount === 0) {
    return {
      error: tr("requestsPage.batch.errorAllFailed").replace("{verb}", verb).replace("{count}", String(failCount)),
      results,
    } satisfies BatchReviewActionState;
  }
  return {
    success: tr("requestsPage.batch.successPartial").replace("{verb}", verb).replace("{okCount}", String(okCount)).replace("{failCount}", String(failCount)),
    results,
  } satisfies BatchReviewActionState;
}
