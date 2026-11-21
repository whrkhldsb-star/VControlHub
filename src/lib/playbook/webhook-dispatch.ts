import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";

import { ForbiddenError } from "@/lib/errors";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { recordDelivery } from "@/lib/monitoring/runtime-metrics";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";
import { detachWebhookResponse, validateWebhookUrlSyntax } from "@/lib/security/webhook-url";

/** The OS lookup cannot be cancelled. Only a result received before the deadline may reach the connector. */
async function resolveAddress(host: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const family = isIP(host);
  if (family) return { address: host, family };
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const records = await Promise.race([lookup(host, { all: true, verbatim: true }), aborted]);
    if (records.length && records.every((record) => !isBlockedIpAddress(record.address))) return records[0];
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchPlaybookWebhook(url: string, init: {
  method: string; headers: Record<string, string>; body?: string; signal: AbortSignal;
}, beforeSend?: () => Promise<void>) {
  const started = performance.now();
  const signal = AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]);
  let dispatcher: Agent | undefined;
  let dispatched = false;
  let ok = false;
  try {
    const syntax = validateWebhookUrlSyntax(url);
    if (!syntax.ok) return { ok: false as const, dispatched };
    const host = new URL(syntax.url).hostname.replace(/^\[|\]$/g, "");
    const pinned = await resolveAddress(host, signal);
    if (!pinned) return { ok: false as const, dispatched };
    // Keep the original HTTPS authority and certificate verification; the
    // connector receives only the address checked by this resolution.
    dispatcher = new Agent({
      headersTimeout: 10_000, bodyTimeout: 10_000,
      connect: { timeout: 10_000, lookup(name, options, callback) {
        if (name !== host) return callback(new Error("Unverified webhook host"), "", 0);
        if (typeof options === "object" && options.all) return callback(null, [pinned], undefined as never);
        callback(null, pinned.address, pinned.family);
      } },
    });
    signal.throwIfAborted();
    await beforeSend?.();
    signal.throwIfAborted();
    dispatched = true;
    const upstream = await fetch(syntax.url, { ...init, signal, dispatcher, redirect: "error" });
    const response = await detachWebhookResponse(upstream as unknown as Response, true);
    ok = response.ok;
    return { ok: true as const, response };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof LeaseLostError) throw error;
    return { ok: false as const, dispatched };
  } finally {
    if (dispatcher) await dispatcher.destroy().catch(() => undefined);
    recordDelivery("webhook", { ok, durationMs: performance.now() - started });
  }
}
