import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import { playbookStepsSchema } from "@/lib/playbook/schema";

type Steps = z.infer<typeof playbookStepsSchema>;

// A reserved, non-routable host keeps a redacted step valid in a v1 package.
// Fingerprint the entire URL: two webhook paths on the same origin can belong
// to different recipients. No URL component or custom header value is public.
const REDACTED_ENDPOINT = "https://redacted.invalid/vch-webhook/";

function endpointMarker(url: string) {
  if (url.startsWith(REDACTED_ENDPOINT) && /^[a-f0-9]{64}$/.test(url.slice(REDACTED_ENDPOINT.length))) return url;
  return REDACTED_ENDPOINT + createHash("sha256").update(url).digest("hex");
}

function isObject(value: Prisma.JsonValue | undefined): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redactStep(step: Prisma.JsonValue): Prisma.JsonValue {
  if (!isObject(step) || step.type !== "call_webhook") return step;
  const config = isObject(step.config) ? step.config : {};
  return {
    ...step,
    config: {
      url: endpointMarker(typeof config.url === "string" ? config.url : ""),
      method: config.method,
      ...(isObject(config.headers) ? { headers: Object.fromEntries(Object.keys(config.headers).map((key) => [key, ""])) } : {}),
      ...(config.body !== undefined ? { body: "" } : {}),
    },
  };
}

export function redactPlaybookWebhooks(steps: Prisma.JsonValue): Prisma.JsonValue {
  return Array.isArray(steps) ? steps.map(redactStep) : [];
}

export function resolvePlaybookWebhooks(steps: Steps, previous?: Prisma.JsonValue) {
  const old = previous ? playbookStepsSchema.safeParse(previous) : undefined;
  let unresolved = false;
  const resolved = steps.map((step) => {
    if (step.type !== "call_webhook" || !step.config.url.startsWith(REDACTED_ENDPOINT)) return step;
    const current = old?.success ? old.data.find(({ id }) => id === step.id) : undefined;
    if (current?.type === "call_webhook" && !current.config.url.startsWith(REDACTED_ENDPOINT)
        && isDeepStrictEqual(redactStep(current), step)) {
      // Keep the whole target configuration together. A package cannot add a
      // Host header or change the request body while borrowing its secret URL.
      return { ...step, config: current.config };
    }
    unresolved = true;
    return step;
  });
  return { steps: resolved, unresolved };
}
