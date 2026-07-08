import Link from "next/link";

import { listShareDirectoryFiles, peekShareToken } from "@/lib/share-link/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { toDateLocale } from "@/lib/i18n/locale-format";
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

  let share: Awaited<ReturnType<typeof peekShareToken>> | null = null;
  let files: Awaited<ReturnType<typeof listShareDirectoryFiles>> = [];
  let errorMessage = "";

  try {
    share = await peekShareToken(token);
    if (share.entryType === "DIRECTORY") {
      files = await listShareDirectoryFiles(share);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : t("sharePage.invalidToken", locale);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--input-bg)] px-4 py-16 text-[var(--text-primary)]">
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-action)]/10 text-2xl">
            {errorMessage ? "🔒" : share?.entryType === "DIRECTORY" ? "📁" : "📦"}
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {errorMessage ? t("sharePage.errorTitle", locale) : share?.entryType === "DIRECTORY" ? t("sharePage.directoryTitle", locale) : t("sharePage.fileTitle", locale)}
          </h1>
        </div>

        {errorMessage ? (
          <div data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-3 text-center text-sm text-[var(--danger)]">
            {errorMessage}
          </div>
        ) : share ? (
          <div className="space-y-5">
            {share.hasPassword && (
              <SharePasswordGate
                token={token}
                label={t("sharePage.passwordRequired", locale)}
                placeholder="••••••"
                submitLabel={t("sharePage.downloadFile", locale)}
              />
            )}

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] p-4">
              <p className="break-all text-base font-medium text-[var(--text-primary)]">
                {share.name || share.path}
              </p>
              <dl className="mt-3 grid gap-1.5 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <dt>{t("sharePage.storageNode", locale)}</dt>
                  <dd className="text-[var(--text-secondary)]">{share.storageNode?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t("sharePage.type", locale)}</dt>
                  <dd className="text-[var(--text-secondary)]">
                    {share.entryType === "DIRECTORY" ? t("sharePage.typeDirectory", locale) : t("sharePage.typeFile", locale)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt>{t("sharePage.path", locale)}</dt>
                  <dd className="break-all text-right text-[var(--text-secondary)]">{share.path}</dd>
                </div>
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
              <a
                href={`/api/share/${encodeURIComponent(token)}`}
                className="block rounded-lg bg-[var(--color-action-strong)] px-4 py-3 text-center text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action)]"
              >
                {t("sharePage.downloadFile", locale)}
              </a>
            )}

            {share.entryType === "DIRECTORY" && (
              <div data-card className=" p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("sharePage.downloadable", locale)}</h2>
                    <span className="text-xs text-[var(--text-muted)]">{t("sharePage.maxIndexed", locale)}</span>
                  </div>
                  {!share.hasPassword && (
                    <a
                      href={`/api/share/${encodeURIComponent(token)}?archive=1`}
                      className="shrink-0 rounded-lg border border-[var(--color-action-border)]/40 px-3 py-1.5 text-center text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action)]/10"
                    >
                      {t("sharePage.downloadDirectory", locale)}
                    </a>
                  )}
                </div>
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
                        {!share.hasPassword && (
                          <a
                            href={`/api/share/${encodeURIComponent(token)}?path=${encodeURIComponent(file.relativePath)}`}
                            className="shrink-0 rounded-lg bg-[var(--color-action-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action)]"
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
