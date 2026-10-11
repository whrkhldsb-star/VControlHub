import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { KnowledgeClient } from "./knowledge-client";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const session = await requirePagePermission("ai:chat", { redirectTo: "/knowledge" });
  const canManage = sessionHasPermission(session, "ai:manage");
  return <KnowledgeClient canManage={canManage} />;
}
