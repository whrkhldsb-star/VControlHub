"use client";

/**
 * `useHostedActionTracker` — follows the hosted actions of the open conversation that are running or waiting
 * for a reviewer, by polling GET /api/ai/hosted-actions/[id] (which also settles an action whose command
 * already finished), and cancels their command through PATCH /api/commands.
 *
 * Actions come from two places:
 *   - registered by the page: a confirmation that runs inline, a review receipt, an Auto / Full auto step of a
 *     stream (`track`);
 *   - restored from the transcript: an action it shows as EXECUTING, or APPROVED with a command request.
 *
 * Polling is bounded: one loop for the open conversation, a 1.5 s interval that slows down for long runs,
 * failures and hidden tabs, and it stops when nothing is open, on a conversation switch and on unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ApiError } from "@/lib/http/api-client-error";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ToastFn } from "@/components/toast-provider";

import { hostedActionCommandRequestId, isTerminalActionStatus } from "../ai-hosted-action-utils";
import type { HostedActionLive, HostedActionStatus, Message } from "../ai-types";

/** Where a followed action is: running now, waiting for another approver, or final. */
export type TrackedPhase = "running" | "review" | "settled";

export type TrackedAction = {
  actionId: string;
  conversationId: string;
  phase: TrackedPhase;
  status: HostedActionStatus | null;
  commandRequestId: string | null;
  /** When it settles the assistant continues by itself (an inline confirmation, a timed-out Auto step). */
  autoContinue: boolean;
  /** The latest poll answer: live target status and masked output. */
  live: HostedActionLive | null;
  /** The last poll failed; the loop retries with a longer interval. */
  pollFailed: boolean;
  cancel: "idle" | "pending" | "requested" | "failed";
};

export type TrackInput = {
  actionId: string;
  conversationId: string;
  mode: "run" | "review";
  commandRequestId?: string | null;
  autoContinue?: boolean;
};

type Registration = {
  conversationId: string;
  mode: "run" | "review";
  commandRequestId: string | null;
  autoContinue: boolean;
};

type LiveEntry = { live: HostedActionLive | null; failures: number; gone: boolean };

export const RUN_POLL_INTERVAL_MS = 1_500;
const REVIEW_POLL_INTERVAL_MS = 15_000;
const HIDDEN_POLL_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const TICK_MS = 500;
/** Polled per tick at most; the rest wait their turn (the read limit is 120 a minute). */
const MAX_POLLS_PER_TICK = 3;

const RUNNING_COMMAND_STATUSES = new Set(["APPROVED", "RUNNING", "CANCELLING"]);

function phaseOf(status: HostedActionStatus | null, live: HostedActionLive | null, mode: "run" | "review"): TrackedPhase {
  if (isTerminalActionStatus(status)) return "settled";
  if (status === "EXECUTING") return "running";
  if (status === "APPROVED") {
    // Filed for review; once a reviewer approved it, the command runs while the card still says APPROVED.
    return live?.command && RUNNING_COMMAND_STATUSES.has(live.command.status) ? "running" : "review";
  }
  return mode === "review" ? "review" : "running";
}

/** How long to wait before polling an action again. */
export function pollIntervalFor(input: { phase: TrackedPhase; failures: number; elapsedMs: number; hidden: boolean }): number {
  let interval = input.phase === "review"
    ? REVIEW_POLL_INTERVAL_MS
    : input.elapsedMs > 60 * 60_000
      ? MAX_BACKOFF_MS
      : input.elapsedMs > 10 * 60_000
        ? 5_000
        : input.elapsedMs > 2 * 60_000
          ? 3_000
          : RUN_POLL_INTERVAL_MS;
  if (input.failures > 0) interval = Math.min(MAX_BACKOFF_MS, interval * 2 ** Math.min(input.failures, 5));
  if (input.hidden) interval = Math.max(interval, HIDDEN_POLL_INTERVAL_MS);
  return interval;
}

export function useHostedActionTracker({
  activeConvId,
  messages,
  addToast,
  onSettled,
}: {
  activeConvId: string | null;
  messages: Message[];
  addToast: ToastFn;
  /** Once per action that a poll found final. */
  onSettled?: (action: TrackedAction) => void;
}) {
  const { t } = useI18n();
  const [registrations, setRegistrations] = useState<Record<string, Registration>>({});
  const [liveById, setLiveById] = useState<Record<string, LiveEntry>>({});
  const [cancelById, setCancelById] = useState<Record<string, TrackedAction["cancel"]>>({});

  // What the transcript says about the open conversation's actions.
  const transcript = useMemo(() => {
    const byId = new Map<string, { status: HostedActionStatus; commandRequestId: string | null }>();
    for (const message of messages) {
      if (activeConvId && message.conversationId && message.conversationId !== activeConvId) continue;
      for (const action of message.hostedActions ?? []) {
        byId.set(action.id, { status: action.status, commandRequestId: hostedActionCommandRequestId(action) });
      }
    }
    return byId;
  }, [messages, activeConvId]);

  const tracked = useMemo(() => {
    const out: Record<string, TrackedAction> = {};
    if (!activeConvId) return out;
    const ids = new Set<string>();
    for (const [id, entry] of transcript) {
      if (entry.status === "EXECUTING" || (entry.status === "APPROVED" && entry.commandRequestId)) ids.add(id);
    }
    for (const [id, registration] of Object.entries(registrations)) {
      if (registration.conversationId === activeConvId) ids.add(id);
    }
    for (const id of ids) {
      const registration = registrations[id];
      const fromTranscript = transcript.get(id) ?? null;
      const entry = liveById[id];
      const live = entry?.live ?? null;
      // A final transcript wins over an older poll; otherwise the poll is the newer word.
      const status: HostedActionStatus | null = isTerminalActionStatus(fromTranscript?.status)
        ? fromTranscript!.status
        : live?.action.status ?? fromTranscript?.status ?? null;
      const mode = registration?.mode ?? (fromTranscript?.status === "APPROVED" ? "review" : "run");
      out[id] = {
        actionId: id,
        conversationId: activeConvId,
        phase: entry?.gone ? "settled" : phaseOf(status, live, mode),
        status,
        commandRequestId: registration?.commandRequestId
          ?? fromTranscript?.commandRequestId
          ?? live?.action.commandRequestId
          ?? live?.command?.id
          ?? null,
        autoContinue: registration?.autoContinue ?? false,
        live,
        pollFailed: (entry?.failures ?? 0) > 0,
        cancel: cancelById[id] ?? "idle",
      };
    }
    return out;
  }, [activeConvId, cancelById, liveById, registrations, transcript]);

  const trackedRef = useRef(tracked);
  const onSettledRef = useRef(onSettled);
  const settledRef = useRef(new Set<string>());
  const pollNowRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    trackedRef.current = tracked;
    onSettledRef.current = onSettled;
  }, [tracked, onSettled]);

  const track = useCallback((input: TrackInput) => {
    setRegistrations((prev) => {
      const existing = prev[input.actionId];
      return {
        ...prev,
        [input.actionId]: {
          conversationId: input.conversationId,
          mode: input.mode,
          commandRequestId: input.commandRequestId ?? existing?.commandRequestId ?? null,
          autoContinue: Boolean(input.autoContinue) || Boolean(existing?.autoContinue),
        },
      };
    });
    // Nothing else to do: an action never polled is due on the loop's next pass (at most TICK_MS away).
  }, []);

  const hasOpen = Object.values(tracked).some((action) => action.phase !== "settled");

  useEffect(() => {
    if (!activeConvId || !hasOpen) return;
    const controller = new AbortController();
    const lastPolled = new Map<string, number>();
    const startedAt = new Map<string, number>();
    const failures = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let running = false;

    const pollOne = async (action: TrackedAction) => {
      try {
        const live = await csrfFetch<HostedActionLive>(`/api/ai/hosted-actions/${action.actionId}`, { signal: controller.signal });
        if (stopped || !live?.action) return;
        failures.set(action.actionId, 0);
        setLiveById((prev) => ({ ...prev, [action.actionId]: { live, failures: 0, gone: false } }));
        if (isTerminalActionStatus(live.action.status) && !settledRef.current.has(action.actionId)) {
          settledRef.current.add(action.actionId);
          onSettledRef.current?.({ ...action, status: live.action.status, live, phase: "settled" });
        }
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        // Gone, or not this account's: stop following it.
        const gone = error instanceof ApiError && (error.status === 404 || error.status === 403);
        const count = (failures.get(action.actionId) ?? 0) + 1;
        failures.set(action.actionId, count);
        setLiveById((prev) => ({
          ...prev,
          [action.actionId]: { live: prev[action.actionId]?.live ?? null, failures: count, gone },
        }));
      }
    };

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const now = Date.now();
        const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
        const due = Object.values(trackedRef.current).filter((action) => {
          if (action.phase === "settled") return false;
          if (!startedAt.has(action.actionId)) startedAt.set(action.actionId, now);
          const interval = pollIntervalFor({
            phase: action.phase,
            failures: failures.get(action.actionId) ?? 0,
            elapsedMs: now - (startedAt.get(action.actionId) ?? now),
            hidden,
          });
          return now - (lastPolled.get(action.actionId) ?? 0) >= interval;
        });
        for (const action of due.slice(0, MAX_POLLS_PER_TICK)) {
          lastPolled.set(action.actionId, Date.now());
          await pollOne(action);
          if (stopped) return;
        }
      } finally {
        running = false;
      }
      if (!stopped) timer = setTimeout(() => void tick(), TICK_MS);
    };

    pollNowRef.current = () => {
      if (stopped) return;
      lastPolled.clear();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), 0);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      pollNowRef.current = () => undefined;
    };
  }, [activeConvId, hasOpen]);

  /** Stop the command behind an action (or withdraw it while it waits for review). */
  const cancel = useCallback(async (actionId: string) => {
    const action = trackedRef.current[actionId];
    const commandRequestId = action?.commandRequestId;
    if (!commandRequestId || action.phase === "settled") return;
    setCancelById((prev) => ({ ...prev, [actionId]: "pending" }));
    try {
      await csrfFetch("/api/commands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", commandRequestId, reason: t("aiPage.live.cancelReason") }),
      });
      setCancelById((prev) => ({ ...prev, [actionId]: "requested" }));
      pollNowRef.current();
    } catch (error) {
      setCancelById((prev) => ({ ...prev, [actionId]: "failed" }));
      addToast("error", getErrorMessage(error, t("aiPage.live.cancelFailed")));
    }
  }, [addToast, t]);

  return { tracked, track, cancel };
}
