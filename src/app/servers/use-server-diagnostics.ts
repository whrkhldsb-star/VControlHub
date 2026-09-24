"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/http/api-client";
import { formatDateTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { useAutoProbeSettings } from "./auto-probe-context";
import type { ServerOverviewDetailsProps } from "./server-overview-details";

const percent = z.number().min(0).max(100);
const metricsSchema = z.object({
  cpu: z.object({ usagePercent: percent }),
  memory: z.object({ usagePercent: percent }),
  disk: z.array(z.object({ mount: z.string(), usagePercent: percent })),
});
type DiagnosticRun = ServerOverviewDetailsProps["diagnosticRun"];

export function useServerDiagnostics(serverId: string, enabled: boolean) {
  const { locale, t } = useI18n();
  const [diagnosticRun, setDiagnosticRun] = useState<DiagnosticRun>({ status: "idle" });
  const identity = `${serverId}:${enabled}`;
  const [stateIdentity, setStateIdentity] = useState(identity);
  if (stateIdentity !== identity) {
    setStateIdentity(identity);
    setDiagnosticRun({ status: "idle" });
  }
  const requestRef = useRef<AbortController | null>(null);
  const { enabled: autoProbeEnabled, intervalSec, hydrated } = useAutoProbeSettings();

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [serverId, enabled]);

  const run = useCallback(async () => {
    if (!enabled || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setDiagnosticRun({ status: "loading" });
    const checkedAt = () => formatDateTime(new Date(), locale);
    // Expire state even when a transport fails to reject after an abort.
    const timeout = window.setTimeout(() => {
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      controller.abort();
      setDiagnosticRun({ status: "error", message: t("serverOverviewCard.realtimeProbeTimeout"), checkedAt: checkedAt() });
    }, 20_000);
    controller.signal.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
    try {
      const response = await api.get<Response>(`/api/servers/monitor?serverId=${encodeURIComponent(serverId)}`, {
        raw: true, cache: "no-store", signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (requestRef.current !== controller) return;
      const remoteError = z.object({ error: z.string().min(1) }).safeParse(payload);
      if (remoteError.success) throw new Error(remoteError.data.error);
      if (!response.ok) throw new Error(t("serverOverviewCard.monitorStatusReturned", { status: response.status }));
      const parsed = metricsSchema.safeParse(payload);
      if (!parsed.success) throw new Error(t("serverOverviewCard.invalidMonitorResponse"));
      const { cpu, memory, disk } = parsed.data;
      const diskText = disk[0] ? t("serverOverviewCard.diskSummary", { mount: disk[0].mount, usage: disk[0].usagePercent }) : "";
      setDiagnosticRun({ status: "success", checkedAt: checkedAt(), summary: t("serverOverviewCard.resourceSummary", {
        cpu: cpu.usagePercent, memory: memory.usagePercent, disk: diskText,
      }) });
    } catch (error) {
      if (requestRef.current !== controller) return;
      setDiagnosticRun({ status: "error", checkedAt: checkedAt(), message: error instanceof Error ? error.message : t("serverOverviewCard.realtimeProbeFailed") });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [serverId, enabled, locale, t]);

  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    if (hydrated && autoProbeEnabled && enabled && document.visibilityState !== "hidden") void runRef.current();
  }, [hydrated, autoProbeEnabled, enabled, serverId]);
  useVisibilityInterval(() => { void runRef.current(); }, hydrated && autoProbeEnabled && enabled ? Math.max(5, intervalSec) * 1000 : null);

  return { diagnosticRun, runRealtimeDiagnostics: run };
}
