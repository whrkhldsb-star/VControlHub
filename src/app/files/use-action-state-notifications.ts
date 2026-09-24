"use client";

import { useEffect, useRef } from "react";

/**
 * Notify-once plumbing shared by the file row action forms
 * (delete / move / rename).
 *
 * `useActionState` re-fires effects on every render pass while a server
 * action settles, so a plain effect would toast the same success twice.
 * The hook keeps a ref of the last handled success message and resets it
 * when the state clears; errors notify once per distinct error value.
 *
 * It also mirrors the optional callbacks into refs so the caller's settle
 * effect can invoke the latest `onRefresh` / `onNotify` without listing
 * them as dependencies (they may be a new closure every render).
 */
export function useActionStateNotifications(
  state: { success?: string | null; error?: string | null },
  onNotify?: (type: "success" | "error" | "info", message: string) => void,
  onRefresh?: () => void,
) {
  const onNotifyRef = useRef(onNotify);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onNotifyRef.current = onNotify;
    onRefreshRef.current = onRefresh;
  }, [onNotify, onRefresh]);

  const handledSuccessRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state.success) {
      handledSuccessRef.current = null;
      return;
    }
    if (handledSuccessRef.current === state.success) return;
    handledSuccessRef.current = state.success;
    onNotifyRef.current?.("success", state.success);
  }, [state.success]);

  useEffect(() => {
    if (!state.error) return;
    onNotify?.("error", state.error);
  }, [state.error, onNotify]);

  return { onNotifyRef, onRefreshRef };
}
