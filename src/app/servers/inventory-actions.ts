"use server";

import { requirePermission } from "@/lib/auth/authorization";
import { getServerOperationTargets } from "@/lib/server/inventory";

export async function loadServerOperationTargets(kind: "command" | "batch", input: { query?: string; page?: number } = {}) {
  if (kind !== "command" && kind !== "batch") throw new Error("Invalid operation kind");
  await requirePermission("server:read");
  const session = await requirePermission(kind === "command" ? "command:create" : "server:write");
  return getServerOperationTargets(session, kind, input);
}
