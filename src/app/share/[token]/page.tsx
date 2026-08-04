import Link from "next/link";
import { AlertTriangle, Download, File, Folder } from "@/components/icons";

import { listShareDirectoryFiles, peekShareToken } from "@/lib/share-link/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { formatBytes } from "@/lib/format/bytes";
import { headers } from "next/headers";
import { SharePasswordGate } from "./share-password-gate";
import { getErrorMessage } from "@/lib/http/error-message";

export const dynamic = "force-dynamic";

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

  try {
    share = await peekShareToken(token, { ip: ip ?? undefined, userAgent: userAgent ?? undefined });
    // Password-locked peeks return a redacted stub (locked=true). Never enumerate
    // directory contents or expose node paths until the password gate succeeds via API.
    if (
      share.entryType === "DIRECTORY" &&
      !share.hasPassword &&
      !(share as { locked?: boolean }).locked &&
      "storageNodeId" in share &&
      typeof (share as { storageNodeId?: string }).storageNodeId === "string"
    ) {
      files = await listShareDirectoryFiles(share as { entryType: string; path: string; storageNodeId: string; storageNode?: { basePath?: string; driver?: string } | null });
    }
  } catch (err) {
    errorMessage = getErrorMessage(err, t("sharePage.invalidToken", locale));
  }

  const isPreviewOnly = share?.permissionLevel === "preview";
  const isLocked = Boolean(share && (share.hasPassword || (share as { locked?: boolean }).locked));

  return (
    <div className="min-h-screen bg-[var(--page-bg)] px-4 py-12 text-[var(--text-primary)] sm:py-16">
      <div className="relative mx-auto w-full max-w-3xl">
          {/* FEAT-P1: Share watermark — traceable token ID overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-4 select-none text-[10px] font-medium tracking-wider text-[var(--text-muted)] opacity-40"
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
          <h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
            {errorMessage ? t("sharePage.errorTitle", locale) : share?.entryType === "DIRECTORY" ? t("sharePage.directoryTitle", locale) : t("sharePage.fileTitle", locale)}
          </h1>
        </div>

        {errorMessage ? (
          <div data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-3 text-center text-sm text-[var(--danger)]">
            {errorMessage}
          </div>
        ) : share ? (
          <div className="space-y-5">
            {isLocked && (
              <SharePasswordGate
                token={token}
                entryType={share.entryType}
                label={t("sharePage.passwordRequired", locale)}
                placeholder="••••••"
                submitLabel={t("sharePage.downloadFile", locale)}
              />
            )}

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
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

            {!share.hasPassword && share.entryType !== "DIRECTORY" && (
              isPreviewOnly ? (
                <div data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-4 py-3 text-center text-sm text-[var(--warning)]">
                  {t("sharePage.previewOnly", locale)}
                </div>
              ) : (
                <a
                  href={`/api/share/${encodeURIComponent(token)}`}
                  data-primary
                  data-action-button data-variant="primary" className="flex items-center justify-center gap-2 px-4 py-3 text-center text-sm"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  {t("sharePage.downloadFile", locale)}
                </a>
              )
            )}

            {share.entryType === "DIRECTORY" && !isLocked && (
              <div data-card className="p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("sharePage.downloadable", locale)}</h2>
                    <span className="text-xs text-[var(--text-muted)]">{t("sharePage.maxIndexed", locale)}</span>
                  </div>
                  {!share.hasPassword && !isPreviewOnly && (
                    <a
                      href={`/api/share/${encodeURIComponent(token)}?archive=1`}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-action-border)]/40 px-3 py-1.5 text-center text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--accent-hover)]/10"
                    >
                      <Download aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("sharePage.downloadDirectory", locale)}
                    </a>
                  )}
                </div>
                {isPreviewOnly && (
                  <div data-tone="amber" className="mb-3 rounded-lg border border-[var(--warning-border)] px-4 py-2 text-center text-xs text-[var(--warning)]">
                    {t("sharePage.previewOnly", locale)}
                  </div>
                )}
                {files.length === 0 ? (
                  <div data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-4 py-3 text-center text-xs text-[var(--warning)]">
                    {t("sharePage.noFiles", locale)}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)] light:divide-[var(--border)]">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{file.name}</div>
                          <div className="truncate text-xs text-[var(--text-muted)]" title={file.relativePath}>{file.relativePath} · {formatSize(locale, file.size)}</div>
                        </div>
                        {!share.hasPassword && !isPreviewOnly && (
                          <a
                            href={`/api/share/${encodeURIComponent(token)}?path=${encodeURIComponent(file.relativePath)}`}
                            data-action-button data-variant="primary" className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
                          >
                            <Download aria-hidden="true" className="h-3.5 w-3.5" />
                            {t("sharePage.download", locale)}
                          </a>
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
