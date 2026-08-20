import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppSlug } from "@/lib/branding";
import { config } from "@/lib/config/env";

const DOWNLOAD_TICKET_TTL_MS = 2 * 60 * 1000;

type ShareDownloadTicketPayload = {
  shareId: string;
  tokenHash: string;
  exp: number;
};

function getTicketSecret(): string {
  const configured = config.auth.storageGatewaySecret ?? config.auth.sessionSecret;
  if (configured) return configured;
  if (config.isProduction) {
    throw new Error("A storage or session secret must be configured before serving password-protected share downloads");
  }
  return "dev-only-share-download-ticket-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", getTicketSecret()).update(payload).digest("base64url");
}

export function getShareDownloadTicketCookieName(): string {
  return `${getAppSlug()}_share_download_ticket`;
}

/** Create a short-lived, token-bound proof of successful password verification. */
export function createShareDownloadTicket(input: { shareId: string; tokenHash: string }): string {
  const payload: ShareDownloadTicketPayload = {
    shareId: input.shareId,
    tokenHash: input.tokenHash,
    exp: Date.now() + DOWNLOAD_TICKET_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Return the linked share id only for an unexpired ticket bound to this URL token. */
export function verifyShareDownloadTicket(ticket: string, tokenHash: string): string | null {
  try {
    const [encoded, receivedSignature, extra] = ticket.split(".");
    if (!encoded || !receivedSignature || extra) return null;
    const expectedSignature = sign(encoded);
    const received = Buffer.from(receivedSignature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ShareDownloadTicketPayload>;
    if (
      typeof payload.shareId !== "string" ||
      typeof payload.tokenHash !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now() ||
      payload.tokenHash !== tokenHash
    ) {
      return null;
    }
    return payload.shareId;
  } catch {
    return null;
  }
}

export const SHARE_DOWNLOAD_TICKET_MAX_AGE_SECONDS = Math.ceil(DOWNLOAD_TICKET_TTL_MS / 1000);
