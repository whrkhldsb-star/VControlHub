import { z } from "zod";

/** Priority spellings the ticket API accepts, in either case. The product stores LOW, NORMAL, HIGH or URGENT. */
export const ticketPriorityInputSchema = z.enum([
  "low", "medium", "normal", "high", "critical", "urgent",
  "LOW", "MEDIUM", "NORMAL", "HIGH", "CRITICAL", "URGENT",
]);

/**
 * The stored priority for an API spelling. MEDIUM is NORMAL; "critical" (common in ticketing tools) is URGENT,
 * the product's highest level: stored as CRITICAL it got the default SLA, and stored as MEDIUM it had no
 * escalation step and no label.
 */
export function normalizeTicketPriority(priority?: string): string | undefined {
  if (!priority) return undefined;
  const upper = priority.toUpperCase();
  if (upper === "MEDIUM" || upper === "NORMAL") return "NORMAL";
  if (upper === "CRITICAL") return "URGENT";
  return upper;
}
