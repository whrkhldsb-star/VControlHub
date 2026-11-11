"use server";

import { requirePermission } from "@/lib/auth/authorization";
import { getServerOperationTargets } from "@/lib/server/inventory";
import { withServerActionLocale } from "@/lib/i18n/server-locale";

export async function loadServerOperationTargets(kind: "command" | "batch", input: { query?: string; page?: number } = {}) {
  return withServerActionLocale(() => loadServerOperationTargetsImpl(kind, input));
}

async function loadServerOperationTargetsImpl(kind: "command" | "batch", input: { query?: string; page?: number } = {}) {
  if (kind !== "command" && kind !== "batch") throw new Error("Invalid operation kind");
  await requirePermission("server:read");
  const session = await requirePermission(kind === "command" ? "command:create" : "server:write");
  return getServerOperationTargets(session, kind, input);
}
