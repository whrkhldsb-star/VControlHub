import Link from "next/link";

import { listShareDirectoryFiles, peekShareToken } from "@/lib/share-link/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { headers } from "next/headers";
import { SharePasswordGate } from "./share-password-gate";

export const dynamic = "force-dynamic";

function formatSize(locale: "zh" | "en", bytes: bigint | number | null) {
  if (bytes == null) return t("sharePage.sizeUnknown", locale);
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
    errorMessage = err instanceof Error ? err.message : t("sharePage.invalidToken", locale);
  }

  const isPreviewOnly = share?.permissionLevel === "preview";
  const isLocked = Boolean(share && (share.hasPassword || (share as { locked?: boolean }).locked));

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16 text-[var(--text-primary)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.12),transparent_55%),var(--page-bg)]"
      />
      <div className="relative w-full max-w-3xl rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] p-8 shadow-[var(--shadow-lg)] backdrop-blur-xl">
          {/* FEAT-P1: Share watermark — traceable token ID overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-4 select-none text-[10px] font-medium tracking-wider text-[var(--text-muted)] opacity-40"
          >
            {token.slice(0, 8)} · {new Date().toISOString().slice(0, 10)}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"
            style={{
              backgroundImage: `repeating-linear-gradient(135deg, transparent, transparent 120px, color-mix(in srgb, var(--text-muted) 3%, transparent) 120px, color-mix(in srgb, var(--text-muted) 3%, transparent) 240px)`,
            }}
          />
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg)] text-2xl">
            {errorMessage ? "🔒" : share?.entryType === "DIRECTORY" ? "📁" : "📦"}
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            {t("sharePage.brand", locale)}
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
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

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
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
                      {new Date(share.expiresAt).toLocaleString(toDateLocale(locale))}
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
                  data-action-button data-variant="primary" className="block px-4 py-3 text-center text-sm"
                >
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
                      className="shrink-0 rounded-lg border border-[var(--color-action-border)]/40 px-3 py-1.5 text-center text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--accent-hover)]/10"
                    >
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
                            data-action-button data-variant="primary" className="shrink-0 px-3 py-1.5 text-xs"
                          >
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
    </main>
  );
}
