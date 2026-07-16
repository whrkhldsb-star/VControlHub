"use client";

import { useCallback, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

type Props = {
  completedBackups: Array<{ id: string; type: string; filePath: string; label: string }>;
  canCreate: boolean;
};

export function MigrationWizardPanel({ completedBackups, canCreate }: Props) {
  const { t } = useI18n();
  const [backupId, setBackupId] = useState(completedBackups[0]?.id ?? "");
  const [packageRef, setPackageRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{
    packageId: string;
    packageRelativeDir: string;
    tarballRelativePath?: string;
  } | null>(null);
  const [packages, setPackages] = useState<
    Array<{
      packageId: string;
      relativeDir: string;
      type: string | null;
      fileSize: number | null;
      hasTarball: boolean;
    }>
  >([]);

  const run = useCallback(
    async (action: "export" | "validate" | "import" | "list") => {
      if (!canCreate && action !== "list") return;
      setBusy(action);
      setError(null);
      setMessage(null);
      try {
        if (action === "list") {
          const data = await csrfFetch<{ packages: typeof packages }>("/api/backups/migration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list" }),
          });
          setPackages(data.packages ?? []);
          setMessage(t("backupsPage.migration.listOk").replace("{count}", String(data.packages?.length ?? 0)));
          return;
        }
        if (action === "export") {
          if (!backupId) throw new Error(t("backupsPage.migration.needBackup"));
          const data = await csrfFetch<{
            packageId: string;
            packageRelativeDir: string;
            tarballRelativePath?: string;
          }>("/api/backups/migration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "export", backupId, note: note || undefined }),
          });
          setLastExport({
            packageId: data.packageId,
            packageRelativeDir: data.packageRelativeDir,
            tarballRelativePath: data.tarballRelativePath,
          });
          setPackageRef(data.packageRelativeDir);
          setMessage(
            t("backupsPage.migration.exportOk")
              .replace("{packageId}", data.packageId)
              .replace("{path}", data.packageRelativeDir),
          );
          return;
        }
        if (!packageRef.trim()) throw new Error(t("backupsPage.migration.needPackage"));
        if (action === "validate") {
          const data = await csrfFetch<{
            ok: boolean;
            packageId?: string;
            issues?: string[];
            type?: string;
          }>("/api/backups/migration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "validate", packageRef: packageRef.trim() }),
          });
          if (!data.ok) {
            throw new Error(
              (data.issues && data.issues.length > 0
                ? data.issues.join("; ")
                : t("backupsPage.migration.validateFail")) as string,
            );
          }
          setMessage(
            t("backupsPage.migration.validateOk")
              .replace("{packageId}", data.packageId ?? "")
              .replace("{type}", data.type ?? ""),
          );
          return;
        }
        const data = await csrfFetch<{
          backupId: string;
          packageId: string;
          type: string;
          filePath: string;
        }>("/api/backups/migration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            packageRef: packageRef.trim(),
            note: note || undefined,
          }),
        });
        setMessage(
          t("backupsPage.migration.importOk")
            .replace("{backupId}", data.backupId)
            .replace("{type}", data.type)
            .replace("{path}", data.filePath),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("backupsPage.migration.error"));
      } finally {
        setBusy(null);
      }
    },
    [backupId, canCreate, note, packageRef, t],
  );

  if (!canCreate) {
    return (
      <p className="text-xs text-[var(--text-muted)]">{t("backupsPage.migration.noPermission")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {t("backupsPage.migration.help")}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {t("backupsPage.migration.exportTitle")}
          </h3>
          <label className="block text-[11px] text-[var(--text-muted)]">
            {t("backupsPage.migration.selectBackup")}
            <select
              value={backupId}
              onChange={(e) => setBackupId(e.target.value)}
              className={`${UI_INPUT} mt-1`}
            >
              {completedBackups.length === 0 ? (
                <option value="">{t("backupsPage.migration.noCompleted")}</option>
              ) : (
                completedBackups.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block text-[11px] text-[var(--text-muted)]">
            {t("backupsPage.migration.note")}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${UI_INPUT} mt-1`}
              placeholder={t("backupsPage.migration.notePlaceholder")}
            />
          </label>
          <button
            type="button"
            disabled={!backupId || busy !== null}
            onClick={() => void run("export")}
            className="min-h-11 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            {busy === "export" ? t("backupsPage.migration.working") : t("backupsPage.migration.export")}
          </button>
          {lastExport && (
            <p className="text-[11px] text-[var(--text-secondary)]">
              {t("backupsPage.migration.exportHint")
                .replace("{dir}", lastExport.packageRelativeDir)
                .replace("{tar}", lastExport.tarballRelativePath ?? `${lastExport.packageRelativeDir}.tar.gz`)}
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            {t("backupsPage.migration.importTitle")}
          </h3>
          <label className="block text-[11px] text-[var(--text-muted)]">
            {t("backupsPage.migration.packageRef")}
            <input
              value={packageRef}
              onChange={(e) => setPackageRef(e.target.value)}
              className={`${UI_INPUT} mt-1 font-mono text-[11px]`}
              placeholder="migration-packages/mig-..."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!packageRef.trim() || busy !== null}
              onClick={() => void run("validate")}
              className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-xs font-medium text-[var(--text-secondary)] disabled:opacity-50"
            >
              {busy === "validate" ? t("backupsPage.migration.working") : t("backupsPage.migration.validate")}
            </button>
            <button
              type="button"
              disabled={!packageRef.trim() || busy !== null}
              onClick={() => void run("import")}
              className="min-h-11 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-3 text-xs font-semibold text-[var(--success)] disabled:opacity-50"
            >
              {busy === "import" ? t("backupsPage.migration.working") : t("backupsPage.migration.import")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("list")}
              className="min-h-11 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] disabled:opacity-50"
            >
              {busy === "list" ? t("backupsPage.migration.working") : t("backupsPage.migration.list")}
            </button>
          </div>
          {packages.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto text-[11px] text-[var(--text-secondary)]">
              {packages.map((pkg) => (
                <li key={pkg.packageId}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => setPackageRef(pkg.relativeDir)}
                  >
                    {pkg.packageId}
                    {pkg.type ? ` · ${pkg.type}` : ""}
                    {pkg.hasTarball ? " · tar.gz" : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {message && <p className="text-xs text-[var(--success)]">{message}</p>}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <p className="text-[11px] text-[var(--text-muted)]">{t("backupsPage.migration.restoreNote")}</p>
    </div>
  );
}
