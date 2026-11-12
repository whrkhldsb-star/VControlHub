import { Prisma } from "@prisma/client";
import { t } from "@/lib/i18n/service-translations";

/**
 * Direct-access strategy builder for both LOCAL and SFTP storage nodes.
 *
 * Lives in its own module because both `service-nodes` (node-level listing)
 * and `service-entries` (entry-level listing) need to derive the same
 * mode/url/description for the same driver+node+path combination.
 */

export type DirectAccessMode = "PROXY" | "DIRECT" | "AUTO";

export type DirectAccessResult =
  | {
      mode: "managed-download";
      description: string;
      href: string | null;
      fallbackHref?: undefined;
      publicBaseUrl?: undefined;
      expiresSeconds?: undefined;
    }
  | {
      mode: "direct-url";
      description: string;
      /** Null for a node-level description: there is no file to link to. */
      href: string | null;
      fallbackHref: string | null;
      publicBaseUrl: string;
      expiresSeconds: number;
    };

export function buildDirectAccessStrategy(input: {
  driver: "LOCAL" | "SFTP" | "WEBDAV";
  nodeId: string;
  host?: string | null;
  port?: number | null;
  relativePath?: string | null;
  directAccessMode?: DirectAccessMode | null;
  publicBaseUrl?: string | null;
  directAccessExpiresSeconds?: number | null;
}): DirectAccessResult {
  if (input.driver === "LOCAL") {
    return {
      mode: "managed-download" as const,
      description: t("backend.storage.directAccess.local"),
      href: input.relativePath
        ? `/api/storage/local?nodeId=${encodeURIComponent(input.nodeId)}&path=${encodeURIComponent(input.relativePath)}`
        : null,
    };
  }

  if (input.driver === "WEBDAV") {
    return { mode: "managed-download", description: t("backend.storage.directAccess.webdavProxy"), href: input.relativePath ? `/api/storage/webdav-download?${new URLSearchParams({ nodeId: input.nodeId, path: input.relativePath })}` : null };
  }
  const host = input.host ?? "unknown";
  const port = input.port ?? 22;
  const params = new URLSearchParams({
    nodeId: input.nodeId,
    path: input.relativePath ?? "",
  });
  // Without a file the download endpoints answer 400; a node's own
  // description (its card) has no link to give.
  const fileLink = (href: string) => (input.relativePath ? href : null);
  const fallbackHref = fileLink(`/api/storage/sftp-download?${params.toString()}`);
  const directParams = new URLSearchParams({
    nodeId: input.nodeId,
    path: input.relativePath ?? "",
  });
  const directHref = fileLink(`/api/storage/direct-access?${directParams.toString()}`);
  const mode = input.directAccessMode ?? "PROXY";

  if ((mode === "DIRECT" || mode === "AUTO") && input.publicBaseUrl) {
    return {
      mode: "direct-url" as const,
      description: t("backend.storage.directAccess.directUrl", { mode: t(mode === "AUTO" ? "backend.storage.directAccess.modeAuto" : "backend.storage.directAccess.modeDirect"), host, port }),
      href: directHref,
      fallbackHref,
      publicBaseUrl: input.publicBaseUrl,
      expiresSeconds: input.directAccessExpiresSeconds ?? 300,
    };
  }

  return {
    mode: "managed-download" as const,
    description: t("backend.storage.directAccess.proxyRelay", { host, port }),
    href: fallbackHref,
  };
}

export function buildStorageConnectionSummary(input: {
  driver: "LOCAL" | "SFTP" | "WEBDAV";
  basePath: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  serverName?: string | null;
}) {
  if (input.driver === "LOCAL") {
    return t("backend.storage.connection.local", { basePath: input.basePath });
  }

  if (input.driver === "WEBDAV") return t("backend.storage.connection.webdav", { basePath: input.basePath });
  const remote = `${input.username ?? "root"}@${input.host ?? "unknown"}:${input.port ?? 22}`;
  return input.serverName
    ? t("backend.storage.connection.sftpBound", { remote, name: input.serverName, basePath: input.basePath })
    : t("backend.storage.connection.sftp", { remote, basePath: input.basePath });
}

export type StorageNodeListRow = Prisma.StorageNodeGetPayload<{
  include: {
    server: {
      select: { id: true; name: true; host: true; port: true; operatingSystem: true; username: true };
    };
    _count: { select: { fileEntries: true } };
  };
}>;
