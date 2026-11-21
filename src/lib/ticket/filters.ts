import type { TicketQuery } from "./query";
import { normalizeTicketPriority } from "./priority";

export function parseTicketFilters(get: (key: string) => string | null | undefined): TicketQuery {
  const read = (key: string) => get(key)?.trim() || undefined;
  const sla = read("slaStatus") ?? read("sla");
  return {
    status: read("status")?.toUpperCase(),
    priority: normalizeTicketPriority(read("priority")),
    category: read("category"),
    assigneeId: read("assigneeId"),
    slaStatus: sla === "ok" || sla === "warning" || sla === "breached" || sla === "none" ? sla : undefined,
    search: read("search") ?? read("q"),
  };
}
