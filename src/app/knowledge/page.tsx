import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell, EmptyState } from "@/components/page-shell";
import { t, getServerLocale } from "@/lib/i18n/translations";
import { KnowledgeClient } from "./knowledge-client";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const locale = await getServerLocale();
  const session = await requireSession("/knowledge");
  if (!sessionHasPermission(session, "ai:chat")) {
    return (
      <PageShell>
        <EmptyState text={t("knowledgePage.noPermission", locale)} variant="boxed" />
      </PageShell>
    );
  }
  const canManage = sessionHasPermission(session, "ai:manage");
  return <KnowledgeClient canManage={canManage} />;
}
