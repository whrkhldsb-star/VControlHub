import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader } from "@/components/page-shell";
import { RemoteDesktop } from "@/components/remote-desktop";

export const dynamic = "force-dynamic";

export default async function RemoteDesktopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePagePermission("server:ssh", {
    redirectTo: `/servers/${encodeURIComponent(id)}/remote-desktop`,
  });
  const server = await prisma.server.findFirst({
    where: { AND: [{ id, operatingSystem: "WINDOWS", enabled: true }, serverTeamWhere(session)] },
    select: { id: true, name: true },
  });
  if (!server) notFound();
  const locale = await getServerLocale();
  return <PageShell maxW="max-w-7xl">
    <PageHeader eyebrow="Windows · RDP" title={t("rdp.title", locale)} description={server.name}>
      <Link href="/servers" data-action-button data-variant="secondary">{t("rdp.back", locale)}</Link>
    </PageHeader>
    <RemoteDesktop serverId={server.id} />
  </PageShell>;
}
