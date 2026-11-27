import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader, StatusScreen } from "@/components/page-shell";
import { ButtonLink } from "@/components/action-button";
import { OpenRemoteDesktop } from "./open-remote-desktop";

export const dynamic = "force-dynamic";

export default async function RemoteDesktopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePagePermission("server:ssh", {
    redirectTo: `/servers/${encodeURIComponent(id)}/remote-desktop`,
  });
  const server = await prisma.server.findFirst({
    where: { AND: [{ id }, serverTeamWhere(session, "connect")] },
    select: { id: true, name: true, host: true, operatingSystem: true, enabled: true },
  });
  if (!server) notFound();
  const locale = await getServerLocale();
  if (!server.enabled || server.operatingSystem !== "WINDOWS") {
    return <StatusScreen title={t("rdp.title", locale)} description={t(!server.enabled ? "rdp.disabledServer" : "rdp.windowsOnly", locale)} actions={<ButtonLink href="/servers">{t("rdp.backServers", locale)}</ButtonLink>} />;
  }
  return <PageShell>
    <PageHeader eyebrow={t("rdp.eyebrow", locale)} title={t("rdp.title", locale)} description={t("rdp.opening", locale)} />
    <OpenRemoteDesktop serverId={server.id} serverName={server.name} host={server.host} />
  </PageShell>;
}
