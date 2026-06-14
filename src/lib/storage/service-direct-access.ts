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
      description: "本机文件由管理端直接提供受控下载与预览。",
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
      description: `远端文件可切换为存储服务器直连（${mode === "AUTO" ? "自动优先直连" : "直连模式"}），不可用时回退到管理端 SFTP 中转（来自 ${host}:${port}）。`,
      href: directHref,
      fallbackHref,
      publicBaseUrl: input.publicBaseUrl,
      expiresSeconds: input.directAccessExpiresSeconds ?? 300,
    };
  }

  return {
    mode: "managed-download" as const,
    description: `远端文件经管理端 SFTP 代理中转下载（来自 ${host}:${port}）。`,
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
    return `本机存储：${input.basePath}`;
  }

  const remote = `${input.username ?? "root"}@${input.host ?? "unknown"}:${input.port ?? 22}`;
  const serverHint = input.serverName ? `（绑定节点 ${input.serverName}）` : "";
  return `SFTP 存储：${remote}${serverHint}，根目录 ${input.basePath}`;
}

export type StorageNodeListRow = Prisma.StorageNodeGetPayload<{
  include: {
    server: {
      select: { id: true; name: true; host: true; port: true; username: true };
    };
    fileEntries: { select: { id: true } };
  };
}>;
