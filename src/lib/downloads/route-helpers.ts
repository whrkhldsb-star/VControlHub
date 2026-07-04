/**
 * Route-level helpers for the downloads API.
 *
 * These pure-logic helpers were extracted from
 * `src/app/api/downloads/route.ts` so the route file stays a thin barrel.
 * They are only consumed by the downloads HTTP handlers.
 */

import {
  getDownloadTargetRelativePath,
} from "@/lib/downloads/target-path";
import {
  deriveDownloadFileNameFromUrl,
} from "@/lib/downloads/helpers";
import { buildDirectAccessStrategy } from "@/lib/storage/service";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { t } from "@/lib/i18n/translations";

export function taskTargetRelativePath(task: { targetPath: string | null; server?: { storageNode?: { basePath: string } | null } | null }) {
  const storageNode = task.server?.storageNode;
  if (!storageNode || !task.targetPath) return null;
  try {
    return getDownloadTargetRelativePath(storageNode.basePath, task.targetPath);
  } catch {
    return null;
  }
}

export function taskCompletedFileRelativePath(task: {
  url: string;
  targetPath: string | null;
  fileName: string | null;
  server?: { storageNode?: { basePath: string } | null } | null;
}) {
  const storageNode = task.server?.storageNode;
  const fileName = task.fileName || deriveDownloadFileNameFromUrl(task.url);
  if (!storageNode || !task.targetPath || !fileName) return null;
  try {
    return getDownloadTargetRelativePath(
      storageNode.basePath,
      `${task.targetPath.replace(/\/$/, "")}/${fileName}`,
    );
  } catch {
    return null;
  }
}

export function taskDownloadAccess(task: {
  locale?: import("@/lib/i18n/translations").Locale;
  url: string;
  status: string;
  targetPath: string | null;
  fileName: string | null;
  relayMode: boolean | null;
  server?: {
    storageNode?: {
      id: string;
      basePath: string;
      driver?: "LOCAL" | "SFTP" | null;
      host?: string | null;
      port?: number | null;
      directAccessMode?: "PROXY" | "DIRECT" | "AUTO" | null;
      publicBaseUrl?: string | null;
      directAccessExpiresSeconds?: number | null;
    } | null;
  } | null;
}) {
  if (task.status !== "COMPLETED") return null;
  const storageNode = task.server?.storageNode;
  const locale = task.locale ?? "zh";
  const relativePath = taskCompletedFileRelativePath(task);
  if (!storageNode || !relativePath) return null;

  const strategy = buildDirectAccessStrategy({
    driver: storageNode.driver === "SFTP" ? "SFTP" : "LOCAL",
    nodeId: storageNode.id,
    host: storageNode.host,
    port: storageNode.port,
    relativePath,
    directAccessMode: storageNode.directAccessMode,
    publicBaseUrl: storageNode.publicBaseUrl,
    directAccessExpiresSeconds: storageNode.directAccessExpiresSeconds,
  });

  const href = strategy.href
    ? `${strategy.href}${strategy.href.includes("?") ? "&" : "?"}download=1`
    : null;
  if (!href) return null;

  const isDirect = strategy.mode === "direct-url";
  const host = storageNode.host ?? "unknown";
  const port = storageNode.port ?? 22;
  const description = storageNode.driver !== "SFTP"
    ? t("downloadsPage.access.localDesc", locale)
    : isDirect
      ? t(storageNode.directAccessMode === "AUTO" ? "downloadsPage.access.directAutoDesc" : "downloadsPage.access.directModeDesc", locale)
        .replace("{host}", host)
        .replace("{port}", String(port))
      : t("downloadsPage.access.relayDesc", locale).replace("{host}", host).replace("{port}", String(port));
  return {
    mode: strategy.mode,
    transport: isDirect ? "direct" as const : "relay" as const,
    href,
    fallbackHref: "fallbackHref" in strategy && strategy.fallbackHref
      ? `${strategy.fallbackHref}${strategy.fallbackHref.includes("?") ? "&" : "?"}download=1`
      : null,
    label: t("apiDownloads.label", locale),
    statusLabel: isDirect ? t("apiDownloads.statusLabelDirect", locale) : t("apiDownloads.statusLabelRelay", locale),
    description,
  };
}

export async function canAccessDownloadTask(input: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/auth/require-session").requireSession>>>;
  task: {
    createdBy: string | null;
    targetPath: string | null;
    server?: { storageNode?: { id: string; basePath: string } | null } | null;
  };
  operation: "read" | "write" | "delete";
}) {
  if (input.task.createdBy === input.session.userId) return true;
  const storageNode = input.task.server?.storageNode;
  if (!storageNode) return false;
  const relativePath = taskTargetRelativePath(input.task);
  if (relativePath === null) return false;
  const decision = await assertStorageAccess({
    session: input.session,
    storageNodeId: storageNode.id,
    relativePath,
    operation: input.operation,
  });
  return decision.allowed;
}
