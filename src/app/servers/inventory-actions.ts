"use server";

import { requirePermission } from "@/lib/auth/authorization";
import { getServerOperationTargets } from "@/lib/server/inventory";
import { withServerActionLocale } from "@/lib/i18n/server-locale";

export async function loadServerOperationTargets(kind: "command" | "batch" | "deployment", input: { query?: string; page?: number } = {}) {
  return withServerActionLocale(() => loadServerOperationTargetsImpl(kind, input));
}

async function loadServerOperationTargetsImpl(kind: "command" | "batch" | "deployment", input: { query?: string; page?: number } = {}) {
  if (kind !== "command" && kind !== "batch" && kind !== "deployment") throw new Error("Invalid operation kind");
  await requirePermission("server:read");
  const session = await requirePermission(kind === "deployment" ? "deploy:run" : kind === "command" ? "command:create" : "server:write");
  const safeInput = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return getServerOperationTargets(session, kind === "deployment" ? "command" : kind, safeInput);
}
