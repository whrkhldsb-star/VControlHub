import crypto from "node:crypto";
import posixPath from "node:path/posix";

import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { assertPublicBaseUrlResolvesPublic, normalizePublicBaseUrl } from "@/lib/storage/direct-access-url";
import { AuthError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
} from "@/lib/storage/remote-path";
import {
  directAccessDownloadQuerySchema,
  directAccessInputSchema,
} from "@/lib/storage/schema";

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

function fallbackUrl(nodeId: string, relativePath: string) {
  const params = new URLSearchParams({ nodeId, path: relativePath });
  return `/api/storage/sftp-download?${params.toString()}`;
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

  const signedPath = normalizeDirectGatewaySignedPath({
    publicBaseUrl: input.publicBaseUrl,
    relativePath: input.relativePath,
  });
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${signedPath}.${expires}`)
    .digest("hex");
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

async function isDirectGatewayHealthy(publicBaseUrl: string) {
	await assertPublicBaseUrlResolvesPublic(publicBaseUrl);
  const healthUrl = new URL(
    "/__vch_health",
    publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_GATEWAY_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.status === 200;
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
    },
  });

  if (!node) {
    throw new NotFoundError("Storage node not found");
  }

  let normalizedRelativePath: string;
  try {
    normalizeRemoteTargetPath(node.basePath, relativePath);
    normalizedRelativePath = normalizeRemoteRelativePath(relativePath);
  } catch {
    return NextResponse.json(
      { error: "Requested path exceeds storage node root directory" },
      { status: 400 },
    );
  }

  const fallback = fallbackUrl(nodeId, normalizedRelativePath);
  const access = await assertStorageAccess({
    session,
    storageNodeId: nodeId,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!access.allowed) {
    throw new ForbiddenError(access.reason);
  }

  if (node.driver !== "SFTP") {
    return { mode: "managed-download", fallbackUrl: fallback };
  }

  if (node.directAccessMode === "DIRECT" || node.directAccessMode === "AUTO") {
    if (node.publicBaseUrl) {
      try {
        const publicBaseUrl = normalizePublicBaseUrl(node.publicBaseUrl);
        if (publicBaseUrl) {
          if (node.directAccessMode === "AUTO") {
            const healthy = await isDirectGatewayHealthy(publicBaseUrl);
            if (!healthy) {
              return { mode: "managed-download", fallbackUrl: fallback };
            }
          }
          return {
            mode: "direct-url",
            url: buildSignedDirectUrl({
              publicBaseUrl,
              relativePath: normalizedRelativePath,
              expiresSeconds: node.directAccessExpiresSeconds ?? 300,
            }),
            fallbackUrl: fallback,
            expiresSeconds: node.directAccessExpiresSeconds ?? 300,
          };
        }
        return { mode: "managed-download", fallbackUrl: fallback };
      } catch (error) {
        if (node.directAccessMode === "DIRECT") {
          const message =
            error instanceof Error ? error.message : "failed to generate direct access link";
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
      if (!session)
        throw new AuthError("Not authenticated");
      const parsed = parseDirectAccessQuery(request);
      if (!parsed.success)
        return NextResponse.json(
          { error: "Missing nodeId or relativePath" },
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
      if (!session)
        throw new AuthError("Not authenticated");

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
    async ({ session }) => {
      await auditUserAction(session?.userId ?? "", "storage.direct-access.stop", {});
      return NextResponse.json({ stopped: true, mode: "managed-download" });
    },
  );
}
