import { WINDOWS_ROOT_PROTOCOL } from "@/lib/server/windows-direct-gateway";
import { apiCopy } from "@/lib/i18n/api-copy";
import crypto from "node:crypto";
import posixPath from "node:path/posix";

import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager, teamWhere } from "@/lib/auth/team-scope";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { normalizePublicBaseUrl } from "@/lib/storage/direct-access-url";
import { fetchWithPinnedDns } from "@/lib/security/pinned-fetch";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
} from "@/lib/storage/remote-path";
import {
  directAccessDownloadQuerySchema,
  directAccessInputSchema,
} from "@/lib/storage/schema";
import { getErrorMessage } from "@/lib/http/error-message";
import { DIRECT_GATEWAY_LINUX_FILE_PROTOCOL } from "@/lib/server/direct-gateway";
import { DIRECT_GATEWAY_KEY_PER_SERVER, DIRECT_GATEWAY_KEY_WINDOWS, directGatewaySigningKey } from "@/lib/server/direct-gateway-key";
import { isServerStorageEndpoint } from "@/lib/server/storage-endpoint";
import { assertNotRecycled } from "@/lib/storage/archive-access";

export const dynamic = "force-dynamic";

// `directAccessSchema` is now a re-export of the shared boundary schema in
// `src/lib/storage/schema.ts`. Both POST validation and
// `parseDirectAccessQuery` (GET, when the route builds a synthetic object
// from `URLSearchParams`) validate against the same shape.
const directAccessSchema = directAccessInputSchema;

type DirectAccessPayload =
  | { mode: "managed-download"; fallbackUrl: string }
  | {
      mode: "direct-url";
      url: string;
      fallbackUrl: string;
      expiresSeconds: number;
    };

const DIRECT_GATEWAY_HEALTH_TIMEOUT_MS = 1500;

/**
 * The download route that serves the node's driver, as buildDirectAccessStrategy picks it for the file manager.
 * It was the SFTP route for every driver, which answers "not an SFTP node" for a local or WebDAV node.
 */
function fallbackUrl(nodeId: string, relativePath: string, driver: string) {
  const params = new URLSearchParams({ nodeId, path: relativePath });
  const route = driver === "LOCAL" ? "local" : (driver === "WEBDAV" || driver === "AGENT") ? "webdav-download" : "sftp-download";
  return `/api/storage/${route}?${params.toString()}`;
}

function forceAttachmentFallbackUrl(fallback: string) {
  return `${fallback}${fallback.includes("?") ? "&" : "?"}download=1`;
}

function redirectToDirectAccessLocation(location: string, requestUrl: string) {
  const response = NextResponse.redirect(new URL(location, requestUrl), {
    status: 302,
  });
  if (location.startsWith("/")) {
    response.headers.set("location", location);
  }
  return response;
}

function getDirectAccessSecret() {
  return config.auth.storageGatewaySecret ?? "";
}

function normalizeDirectGatewaySignedPath(input: {
  publicBaseUrl: string;
  relativePath: string;
}) {
  const basePathname = new URL(input.publicBaseUrl).pathname;
  const basePrefix = posixPath
    .normalize(`/${decodeURIComponent(basePathname).replace(/^\/+|\/+$/g, "")}`)
    .replace(/\/$/, "");
  const relativePathname = posixPath.normalize(
    `/${input.relativePath
      .split("/")
      .filter(Boolean)
      .join("/")}`,
  );

  return posixPath
    .normalize(`${basePrefix === "/" ? "" : basePrefix}${relativePathname}`)
    .replace(/\/+/g, "/");
}


function buildSignedDirectUrl(input: {
  publicBaseUrl: string;
  relativePath: string;
  expiresSeconds: number;
  linuxTargetPath: string | null;
  targetPath: string;
  /** The server whose gateway serves the node, and which key that gateway holds. */
  gateway: { serverId: string | null; keyVersion: number };
}) {
  const base = input.publicBaseUrl.endsWith("/")
    ? input.publicBaseUrl
    : `${input.publicBaseUrl}/`;
  const relativeSegments = input.relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  const url = new URL(relativeSegments.join("/"), base);
  const expires = Math.floor(Date.now() / 1000) + input.expiresSeconds;
  const secret = getDirectAccessSecret();

  if (!secret) {
    throw new Error("Direct access signing key is not configured STORAGE_DIRECT_ACCESS_SECRET");
  }
  // Each gateway installed since the per-server keys verifies with its own key (see direct-gateway-key.ts).
  const signingKey = directGatewaySigningKey(secret, { ...input.gateway, operatingSystem: input.linuxTargetPath === null ? "WINDOWS" : "LINUX" });

  const message = input.linuxTargetPath === null
    ? `${WINDOWS_ROOT_PROTOCOL}\0${input.targetPath}\0${normalizeDirectGatewaySignedPath(input)}\0${expires}`
    : `${DIRECT_GATEWAY_LINUX_FILE_PROTOCOL}\0${input.linuxTargetPath}\0${expires}`;
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(message)
    .digest("hex");
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

async function probeDirectGateway(url: URL, linuxFile: boolean) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_GATEWAY_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchWithPinnedDns(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    // The probe uses only headers. Cancel any response body to release the dispatcher.
    try {
      return response.status === 200 && (
        response.headers.get("x-vch-file-access") === (linuxFile ? DIRECT_GATEWAY_LINUX_FILE_PROTOCOL : WINDOWS_ROOT_PROTOCOL)
      );
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDirectAccessPayload(input: {
  nodeId: string;
  relativePath: string;
  session: SessionPayload;
}): Promise<DirectAccessPayload | NextResponse> {
  const { nodeId, relativePath, session } = input;
  const node = await prisma.storageNode.findFirst({
    where: { id: nodeId, ...teamWhere(session) },
    select: {
      basePath: true,
      driver: true,
      directAccessMode: true,
      publicBaseUrl: true,
      directAccessExpiresSeconds: true,
      serverId: true,
      teamId: true,
      host: true,
      port: true,
      username: true,
      hostKeySha256: true,
      server: { select: { directGatewayKeyVersion: true, operatingSystem: true, teamId: true, host: true, port: true, username: true, hostKeySha256: true, publicUrl: true } },
    },
  });

  if (!node) {
    throw new NotFoundError(apiCopy("apiCopy.storage.node.not.found.3b3ec488"));
  }

  let targetPath: string;
  let normalizedRelativePath: string;
  try {
    targetPath = normalizeRemoteTargetPath(node.basePath, relativePath);
    normalizedRelativePath = normalizeRemoteRelativePath(relativePath);
  } catch {
    return NextResponse.json(
      { error: apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2") },
      { status: 400 },
    );
  }

  const fallback = fallbackUrl(nodeId, normalizedRelativePath, node.driver);
  const access = await assertStorageAccess({
    session,
    storageNodeId: nodeId,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!access.allowed) {
    throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
  }
  const boundServer = node.driver === "SFTP" && node.server && isServerStorageEndpoint(node.server, node) ? node.server : null;
  await assertNotRecycled(nodeId, normalizedRelativePath, "read", node.driver, boundServer?.operatingSystem === "WINDOWS");

  if (node.driver !== "SFTP" || (node.server && !boundServer)) {
    return { mode: "managed-download", fallbackUrl: fallback };
  }

  // Without a gateway key of its own (no server, or a gateway installed before per-server keys) the link would be
  // signed with the hub's shared secret, over a path the caller picks through the node's publicBaseUrl and the
  // relative path. Every older gateway accepts that secret, so a customer with its own storage node could mint links
  // to files on gateways it has no access to. Only the platform administrator, who holds that secret anyway, still
  // gets such links; everyone else is served through the hub until the gateway is enabled again.
  const gateway = { serverId: node.serverId ?? null, keyVersion: node.server?.directGatewayKeyVersion ?? 1 };
  const linuxFile = node.server?.operatingSystem !== "WINDOWS";
  if (linuxFile && node.server && node.username != null && node.username !== node.server.username) {
    return { mode: "managed-download", fallbackUrl: fallback };
  }
  if (!linuxFile && (!gateway.serverId || gateway.keyVersion < DIRECT_GATEWAY_KEY_WINDOWS)) {
    return { mode: "managed-download", fallbackUrl: fallback };
  }
  const gatewayHasOwnKey = Boolean(gateway.serverId) && gateway.keyVersion >= DIRECT_GATEWAY_KEY_PER_SERVER;
  if (!gatewayHasOwnKey && !isGlobalTeamManager(session)) {
    return { mode: "managed-download", fallbackUrl: fallback };
  }

  if (node.directAccessMode === "DIRECT" || node.directAccessMode === "AUTO") {
    if (node.publicBaseUrl) {
      try {
        const publicBaseUrl = normalizePublicBaseUrl(node.publicBaseUrl);
        if (publicBaseUrl) {
          if (!linuxFile && publicBaseUrl !== normalizePublicBaseUrl(node.server?.publicUrl)) {
            return { mode: "managed-download", fallbackUrl: fallback };
          }
          const url = buildSignedDirectUrl({
            publicBaseUrl,
            relativePath: normalizedRelativePath,
            expiresSeconds: node.directAccessExpiresSeconds ?? 300,
            linuxTargetPath: linuxFile ? targetPath : null,
            targetPath,
            gateway,
          });
          // Both gateways must verify the signed target against their installed root.
          if (!await probeDirectGateway(new URL(url), linuxFile)) {
            return { mode: "managed-download", fallbackUrl: fallback };
          }
          return {
            mode: "direct-url",
            url,
            fallbackUrl: fallback,
            expiresSeconds: node.directAccessExpiresSeconds ?? 300,
          };
        }
        return { mode: "managed-download", fallbackUrl: fallback };
      } catch (error) {
        if (node.directAccessMode === "DIRECT") {
          const message =
            getErrorMessage(error, "failed to generate direct access link");
          return NextResponse.json(
            { error: message, mode: "managed-download", fallbackUrl: fallback },
            { status: 500 },
          );
        }
      }
    }
  }

  return { mode: "managed-download", fallbackUrl: fallback };
}

function parseDirectAccessQuery(request: Request) {
  const url = new URL(request.url);
  return directAccessSchema.safeParse({
    nodeId: url.searchParams.get("nodeId") ?? "",
    relativePath:
      url.searchParams.get("relativePath") ||
      url.searchParams.get("path") ||
      "",
  });
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read" },
    async ({ session }) => {
      const parsed = parseDirectAccessQuery(request);
      if (!parsed.success)
        return NextResponse.json(
          { error: apiCopy("apiCopy.missing.nodeid.or.relativepath.3659e972") },
          { status: 400 },
        );

      const payload = await resolveDirectAccessPayload({
        ...parsed.data,
        session,
      });
      if (payload instanceof NextResponse) return payload;

      const shouldForceDownload = parseSearchParams(
        request,
        directAccessDownloadQuerySchema,
      ).download;
      const redirectUrl = payload.mode === "direct-url"
        ? shouldForceDownload
          ? forceAttachmentFallbackUrl(payload.url)
          : payload.url
        : shouldForceDownload
          ? forceAttachmentFallbackUrl(payload.fallbackUrl)
          : payload.fallbackUrl;
      return redirectToDirectAccessLocation(redirectUrl, request.url);
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", rateLimit: UPLOAD_LIMIT, bodySchema: directAccessSchema },
    async ({ session, body }) => {
      const payload = await resolveDirectAccessPayload({
        ...body,
        session,
      });
      if (payload instanceof NextResponse) return payload;
      return NextResponse.json(payload);
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", rateLimit: UPLOAD_LIMIT },
    async () => {
      // Compatibility no-op for old clients (direct-access mode is a
      // per-storage-node setting managed through the node endpoints). It must
      // not write an audit entry: "storage.direct-access.stop" events for a
      // stop that never happened poison the compliance trail.
      return NextResponse.json({ stopped: true, mode: "managed-download" });
    },
  );
}
