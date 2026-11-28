"use client";

/**
 * `useAiContinuation` — decides when the assistant resumes after the actions of its last turn settled
 * (POST /api/ai/conversations/[id]/continue), and offers the button that does it by hand.
 *
 * It continues by itself only for an action this page started and watched to the end (an inline
 * confirmation, an Auto step the stream stopped waiting for), after a short grace period the user can skip or
 * pause, and never:
 *   - twice for the same assistant turn (a failure leaves the button, not a retry loop);
 *   - while an answer streams, or while the composer holds a draft;
 *   - more than MAX_CONSECUTIVE_AUTO_CONTINUES times without the user writing in between.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { continuationCandidate, isTerminalActionStatus } from "../ai-hosted-action-utils";
import type { Message } from "../ai-types";
import type { TrackedAction } from "./use-hosted-action-tracker";

export const AUTO_CONTINUE_DELAY_MS = 1_500;
export const MAX_CONSECUTIVE_AUTO_CONTINUES = 3;

export type ContinuationView = {
  /** hidden: nothing to continue. available: the button. auto: continuing after the grace period. */
  state: "hidden" | "available" | "auto";
  /** Auto-continue stopped because it ran MAX times in a row. */
  limitReached: boolean;
  continueNow: () => void;
  pause: () => void;
  /** The user wrote a message: auto-continue may run again. */
  resetAutoBudget: () => void;
};

export function useAiContinuation({
  activeConvId,
  messages,
  tracked,
  streaming,
  composerDirty,
  continueConversation,
}: {
  activeConvId: string | null;
  messages: Message[];
  tracked: Record<string, TrackedAction>;
  streaming: boolean;
  composerDirty: boolean;
  continueConversation: () => Promise<boolean>;
}): ContinuationView {
  // Turns already continued (or paused): never continued automatically again.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  const [autoCount, setAutoCount] = useState(0);
  const candidate = useMemo(() => continuationCandidate(messages), [messages]);
  const key = candidate && activeConvId ? `${activeConvId}:${candidate.messageId}` : null;
  const ready = Boolean(candidate?.settled) && !streaming && key !== null;
  const watchedToEnd = Boolean(candidate?.actionIds.some((id) => {
    const action = tracked[id];
    return Boolean(action?.autoContinue) && isTerminalActionStatus(action?.status);
  }));
  const eligible = ready && watchedToEnd && !handled.has(key!);
  const limitReached = eligible && autoCount >= MAX_CONSECUTIVE_AUTO_CONTINUES;
  const auto = eligible && !composerDirty && !limitReached;

  useEffect(() => {
    if (!auto || !key) return;
    const timer = setTimeout(() => {
      setHandled((prev) => new Set(prev).add(key));
      setAutoCount((count) => count + 1);
      void continueConversation();
    }, AUTO_CONTINUE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [auto, key, continueConversation]);

  const continueNow = useCallback(() => {
    if (key) setHandled((prev) => new Set(prev).add(key));
    void continueConversation();
  }, [continueConversation, key]);

  const pause = useCallback(() => {
    if (key) setHandled((prev) => new Set(prev).add(key));
  }, [key]);

  const resetAutoBudget = useCallback(() => setAutoCount(0), []);

  return {
    state: !ready ? "hidden" : auto ? "auto" : "available",
    limitReached,
    continueNow,
    pause,
    resetAutoBudget,
  };
}
