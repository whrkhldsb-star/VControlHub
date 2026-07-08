import { Prisma } from "@prisma/client";

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
      href: string;
      fallbackHref: string;
      publicBaseUrl: string;
      expiresSeconds: number;
    };

export function buildDirectAccessStrategy(input: {
  driver: "LOCAL" | "SFTP";
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
      description: "Local files are provided directly by the management side for controlled download and preview.",
      href: input.relativePath
        ? `/api/storage/local?nodeId=${encodeURIComponent(input.nodeId)}&path=${encodeURIComponent(input.relativePath)}`
        : null,
    };
  }

  const host = input.host ?? "unknown";
  const port = input.port ?? 22;
  const params = new URLSearchParams({
    nodeId: input.nodeId,
    path: input.relativePath ?? "",
  });
  const fallbackHref = `/api/storage/sftp-download?${params.toString()}`;
  const directParams = new URLSearchParams({
    nodeId: input.nodeId,
    path: input.relativePath ?? "",
  });
  const directHref = `/api/storage/direct-access?${directParams.toString()}`;
  const mode = input.directAccessMode ?? "PROXY";

  if ((mode === "DIRECT" || mode === "AUTO") && input.publicBaseUrl) {
    return {
      mode: "direct-url" as const,
      description: `Remote files can switch to storage server direct access (${mode === "AUTO" ? "auto prefer direct" : "direct mode"}), falling back to hub SFTP relay when unavailable (from ${host}:${port}).`,
      href: directHref,
      fallbackHref,
      publicBaseUrl: input.publicBaseUrl,
      expiresSeconds: input.directAccessExpiresSeconds ?? 300,
    };
  }

  return {
    mode: "managed-download" as const,
    description: `Remote files are downloaded via management-side SFTP proxy relay (from ${host}:${port}).`,
    href: fallbackHref,
  };
}

export function buildStorageConnectionSummary(input: {
  driver: "LOCAL" | "SFTP";
  basePath: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  serverName?: string | null;
}) {
  if (input.driver === "LOCAL") {
    return `Local storage: ${input.basePath}`;
  }

  const remote = `${input.username ?? "root"}@${input.host ?? "unknown"}:${input.port ?? 22}`;
  const serverHint = input.serverName ? ` (bound node ${input.serverName})` : "";
  return `SFTP storage: ${remote}${serverHint}, root directory ${input.basePath}`;
}

export type StorageNodeListRow = Prisma.StorageNodeGetPayload<{
  include: {
    server: {
      select: { id: true; name: true; host: true; port: true; username: true };
    };
    fileEntries: { select: { id: true } };
  };
}>;
