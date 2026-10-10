import Link from "next/link";
import { AlertTriangle, Download, File, Folder, LinkIcon } from "@/components/icons";

import { listShareDirectoryFiles, peekShareToken } from "@/lib/share-link/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { formatBytes } from "@/lib/format/bytes";
import { headers, cookies } from "next/headers";
import { getShareDownloadTicketCookieName, verifyShareDownloadTicket } from "@/lib/share-link/download-ticket";
import { hashShareToken } from "@/lib/share-link/service";
import { SharePasswordGate } from "./share-password-gate";
import { getErrorMessage } from "@/lib/http/error-message";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { Notice } from "@/components/ui-primitives";

export const dynamic = "force-dynamic";

/**
 * Per-IP throttle for the public share landing page. Unlike the download API
 * route (which already runs withRateLimit), this server component was
 * unthrottled while doing real work on every anonymous hit — a DB peek plus, for
 * directories, a storage-node/SFTP directory listing. That let a single client
 * hammer the storage backend for free. 30 renders/min/IP is generous for humans
 * yet caps automated abuse.
 */
const SHARE_PAGE_RENDER_LIMIT = { maxRequests: 30, windowMs: 60_000 };

function formatSize(locale: "zh" | "en", bytes: bigint | number | null) {
  return formatBytes(bytes, { fallback: t("sharePage.sizeUnknown", locale) });
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locale = await getServerLocale();

  // Extract client IP and user-agent for access logging.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("cf-connecting-ip") || null;
  const userAgent = hdrs.get("user-agent") || null;

  let share: Awaited<ReturnType<typeof peekShareToken>> | null = null;
  let files: Awaited<ReturnType<typeof listShareDirectoryFiles>> = [];
  let errorMessage = "";

  // Throttle before any DB / storage work so anonymous floods cannot amplify
  // into repeated backend I/O.
  const rateLimitId = `share-page:${ip ?? "unknown"}`;
  const rate = await checkRateLimitAsync(rateLimitId, SHARE_PAGE_RENDER_LIMIT);
  if (!rate.allowed) {
    errorMessage = t("sharePage.tooManyRequests", locale);
  } else {
    try {
      const ticket = (await cookies()).get(getShareDownloadTicketCookieName())?.value;
      const authorizedShareId = ticket ? verifyShareDownloadTicket(ticket, hashShareToken(token)) : null;
      share = await peekShareToken(token, { ip: ip ?? undefined, userAgent: userAgent ?? undefined, authorizedShareId });
      // Password-locked peeks return a redacted stub (locked=true). Never enumerate
      // directory contents or expose node paths until the password gate succeeds via API.
      if (
        share.entryType === "DIRECTORY" &&
        !share.locked &&
        !(share as { locked?: boolean }).locked &&
        "storageNodeId" in share &&
        typeof (share as { storageNodeId?: string }).storageNodeId === "string"
      ) {
        files = await listShareDirectoryFiles(share as { entryType: string; path: string; storageNodeId: string; storageNode?: { basePath?: string; driver?: string } | null });
      }
    } catch (err) {
      errorMessage = getErrorMessage(err, t("sharePage.invalidToken", locale));
    }
  }

  const isPreviewOnly = share?.permissionLevel === "preview";
  const isLocked = Boolean(share && (share.hasPassword || (share as { locked?: boolean }).locked));

  return (
    <div className="min-h-screen bg-[var(--page-bg)] px-4 py-12 text-[var(--text-primary)] sm:py-16">
      <div className="relative mx-auto w-full max-w-3xl">
          {/* Keep the traceable share marker readable without covering the heading. */}
          <div
            aria-hidden="true"
            className="pointer-events-none mb-4 select-none break-all text-right text-xs font-medium text-[var(--text-muted)]"
          >
            {token.slice(0, 8)} · {new Date().toISOString().slice(0, 10)}
          </div>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]">
            {errorMessage ? (
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            ) : share?.entryType === "DIRECTORY" ? (
              <Folder aria-hidden="true" className="h-5 w-5" />
            ) : (
              <File aria-hidden="true" className="h-5 w-5" />
            )}
          </div>
          <p className="text-xs font-semibold uppercase text-[var(--accent)]">
            {t("sharePage.brand", locale)}
          </p>
          <h1 className="ui-title-page mt-2">
            {errorMessage ? t("sharePage.errorTitle", locale) : share?.entryType === "DIRECTORY" ? t("sharePage.directoryTitle", locale) : t("sharePage.fileTitle", locale)}
          </h1>
        </div>

        {errorMessage ? (
          <Notice tone="danger" className="text-center">
            {errorMessage}
          </Notice>
        ) : share ? (
          <div className="space-y-5">
            {isLocked && (
              <SharePasswordGate
                token={token}
                entryType={share.entryType}
                label={t("sharePage.passwordRequired", locale)}
                placeholder="••••••"
                submitLabel={t("sharePage.downloadFile", locale)}
                failedLabel={t("sharePage.downloadFailed", locale)}
                failedStatusTemplate={t("sharePage.downloadFailedStatus", locale)}
              />
            )}

            <div data-tile className="p-4">
              <p className="break-all text-base font-medium text-[var(--text-primary)]">
                {isLocked ? (share.name || t("sharePage.fileTitle", locale)) : (share.name || share.path)}
              </p>
              <dl className="mt-3 grid gap-1.5 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                {!isLocked ? (
                <div className="flex justify-between gap-3">
                  <dt>{t("sharePage.storageNode", locale)}</dt>
                  <dd className="text-[var(--text-secondary)]">{share.storageNode?.name ?? "—"}</dd>
                </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt>{t("sharePage.type", locale)}</dt>
                  <dd className="text-[var(--text-secondary)]">
                    {share.entryType === "DIRECTORY" ? t("sharePage.typeDirectory", locale) : t("sharePage.typeFile", locale)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t("sharePage.permissionLevel", locale)}</dt>
                  <dd className="text-[var(--text-secondary)]">
                    {share.permissionLevel === "preview" ? t("sharePage.permissionPreview", locale) : t("sharePage.permissionDownload", locale)}
                  </dd>
                </div>
                {!isLocked ? (
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt>{t("sharePage.path", locale)}</dt>
                  <dd className="break-all text-right text-[var(--text-secondary)]">{share.path}</dd>
                </div>
                ) : null}
                {share.expiresAt ? (
                  <div className="flex justify-between gap-3 sm:col-span-2">
                    <dt>{t("sharePage.expiresAt", locale)}</dt>
                    <dd className="text-[var(--text-secondary)]">
                      {formatDateTime(share.expiresAt, locale)}
                    </dd>
                  </div>
                ) : (
                  <div className="flex justify-between gap-3">
                    <dt>{t("sharePage.expires", locale)}</dt>
                    <dd className="text-[var(--text-secondary)]">{t("sharePage.permanent", locale)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {!share.locked && share.entryType !== "DIRECTORY" && (
              isPreviewOnly ? (
                <Notice tone="warning" className="text-center">
                  {t("sharePage.previewOnly", locale)}
                </Notice>
              ) : (
   <div className="grid gap-2 sm:grid-cols-2">
     <a href={`/api/share/${encodeURIComponent(token)}?inline=1`} target="_blank" rel="noreferrer" data-action-button data-size="lg" data-variant="primary" className="flex items-center justify-center gap-2">
       <LinkIcon aria-hidden="true" className="h-4 w-4" />
       {t("sharePage.openFile", locale)}
     </a>
     <a href={`/api/share/${encodeURIComponent(token)}`} download data-action-button data-size="lg" data-variant="secondary" className="flex items-center justify-center gap-2">
       <Download aria-hidden="true" className="h-4 w-4" />
       {t("sharePage.downloadFile", locale)}
     </a>
   </div>
              )
            )}

            {share.entryType === "DIRECTORY" && !isLocked && (
              <div data-card className="p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="ui-title-section">{t("sharePage.downloadable", locale)}</h2>
                    <span className="text-xs text-[var(--text-muted)]">{t("sharePage.maxIndexed", locale)}</span>
                  </div>
                  {!share.locked && !isPreviewOnly && share.storageNode.driver !== "WEBDAV" && (
                    <a
                      href={`/api/share/${encodeURIComponent(token)}?archive=1`}
                      download
                      data-action-button=""
                      data-variant="outline"
                      data-size="sm"
                      className="shrink-0"
                    >
                      <Download aria-hidden="true" />
                      {t("sharePage.downloadDirectory", locale)}
                    </a>
                  )}
                </div>
                {isPreviewOnly && (
                  <Notice tone="warning" compact className="mb-3 text-center">
                    {t("sharePage.previewOnly", locale)}
                  </Notice>
                )}
                {files.length === 0 ? (
                  <Notice tone="warning" compact className="text-center">
                    {t("sharePage.noFiles", locale)}
                  </Notice>
                ) : (
                  <div className="divide-y divide-[var(--border)] light:divide-[var(--border)]">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{file.name}</div>
                          <div className="truncate text-xs text-[var(--text-muted)]" title={file.relativePath}>{file.relativePath} · {formatSize(locale, file.size)}</div>
                        </div>
                        {!share.locked && !isPreviewOnly && (
                          <div className="flex shrink-0 gap-2">
                            <a href={`/api/share/${encodeURIComponent(token)}?path=${encodeURIComponent(file.relativePath)}&inline=1`} target="_blank" rel="noreferrer" data-action-button data-size="sm" data-variant="secondary" className="inline-flex items-center gap-1.5">
                              <LinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
                              {t("sharePage.openFile", locale)}
                            </a>
                            <a href={`/api/share/${encodeURIComponent(token)}?path=${encodeURIComponent(file.relativePath)}`} download data-action-button data-size="sm" data-variant="primary" className="inline-flex items-center gap-1.5">
                              <Download aria-hidden="true" className="h-3.5 w-3.5" />
                              {t("sharePage.download", locale)}
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-[var(--text-muted)] transition hover:text-[var(--text-secondary)] light:hover:text-[var(--text-disabled)]">
            {t("sharePage.brand", locale)}
          </Link>
        </div>
      </div>
    </div>
  );
}
