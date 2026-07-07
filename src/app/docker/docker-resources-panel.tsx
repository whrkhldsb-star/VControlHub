"use client";
import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
type ResourceType = "networks" | "volumes";
type DockerNetwork = {
  Id?: string;
  Name: string;
  Driver?: string;
  Scope?: string;
};
type DockerVolume = {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  Scope?: string;
};
type DetailState = { title: string; json: string } | null;
type PendingDelete = { type: ResourceType; name: string } | null;
function resourceName(item: DockerNetwork | DockerVolume) {
  return "Name" in item ? item.Name : "";
}
function resourceMeta(item: DockerNetwork | DockerVolume) {
  const parts = [item.Driver, "Scope" in item ? item.Scope : undefined].filter(
    Boolean,
  );
  return parts.join(" · ") || "local";
}
function formatCopy(
  template: string,
  replacements: Record<string, string | number>,
) {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
export function DockerResourcesPanel() {
  const { t } = useI18n();
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [activeType, setActiveType] = useState<ResourceType>("networks");
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("local");
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailState>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const resourceKind = useCallback(
    (type: ResourceType) =>
      t(
        type === "networks"
          ? "dockerResources.kind.network"
          : "dockerResources.kind.volume",
      ),
    [t],
  );
  const fetchResources = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [networkData, volumeData] = await Promise.all([
        csrfFetch("/api/docker/resources?type=networks"),
        csrfFetch("/api/docker/resources?type=volumes"),
      ]);
      if (networkData.error) throw new Error(networkData.error);
      if (volumeData.error) throw new Error(volumeData.error);
      setNetworks(Array.isArray(networkData.data) ? networkData.data : []);
      const volumePayload = volumeData.data as
        { Volumes?: DockerVolume[] } | DockerVolume[] | undefined;
      setVolumes(
        Array.isArray(volumePayload)
          ? volumePayload
          : (volumePayload?.Volumes ?? []),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("dockerResources.error.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchResources();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchResources]);
  async function createResource() {
    const cleanName = name.trim();
    if (!cleanName) return;
    setBusyKey(`create:${activeType}`);
    setError("");
    try {
      const data = await csrfFetch("/api/docker/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeType,
          action: "create",
          name: cleanName,
          driver: driver.trim() || "local",
        }),
      });
      if (data.error) throw new Error(data.error);
      setName("");
      await fetchResources();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("dockerResources.error.create"),
      );
    } finally {
      setBusyKey(null);
    }
  }
  async function inspectResource(type: ResourceType, itemName: string) {
    setBusyKey(`inspect:${type}:${itemName}`);
    setError("");
    try {
      const data = await csrfFetch(
        `/api/docker/resources?type=${type}&name=${encodeURIComponent(itemName)}`,
      );
      if (data.error) throw new Error(data.error);
      setDetail({
        title: formatCopy(t("dockerResources.inspect.title"), {
          kind: resourceKind(type),
          name: itemName,
        }),
        json: JSON.stringify(data.data, null, 2),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("dockerResources.error.inspect"),
      );
    } finally {
      setBusyKey(null);
    }
  }
  async function confirmDeleteResource() {
    if (!pendingDelete) return;
    const { type, name: itemName } = pendingDelete;
    setBusyKey(`delete:${type}:${itemName}`);
    setError("");
    try {
      const data = await csrfFetch("/api/docker/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, action: "delete", name: itemName }),
      });
      if (data.error) throw new Error(data.error);
      setPendingDelete(null);
      await fetchResources();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("dockerResources.error.delete"),
      );
    } finally {
      setBusyKey(null);
    }
  }
  function renderList(
    type: ResourceType,
    items: Array<DockerNetwork | DockerVolume>,
  ) {
    const kind = resourceKind(type);
    return (
      <div className="space-y-2">
        {" "}
        {items.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              type === "networks"
                ? "dockerResources.empty.networks"
                : "dockerResources.empty.volumes",
            )}
          </p>
        ) : null}{" "}
        {items.map((item) => {
          const itemName = resourceName(item);
          const key = `${type}:${itemName}`;
          return (
            <div
              key={key}
              className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3"
            >
              {" "}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {" "}
                <div className="min-w-0">
                  {" "}
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {itemName}
                  </p>{" "}
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                    {resourceMeta(item)}
                  </p>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <button
                    type="button"
                    aria-label={formatCopy(t("dockerResources.inspectAria"), {
                      kind,
                      name: itemName,
                    })}
                    onClick={() => inspectResource(type, itemName)}
                    disabled={busyKey === `inspect:${key}`}
                    className="min-h-10 rounded-lg bg-[var(--color-action)]/10 px-3 py-1 text-xs text-[var(--color-action)] transition hover:bg-[var(--color-action)]/20 disabled:opacity-50"
                  >
                    {t("dockerResources.inspect")}
                  </button>{" "}
                  <button
                    type="button"
                    aria-label={formatCopy(t("dockerResources.deleteAria"), {
                      kind,
                      name: itemName,
                    })}
                    onClick={() => setPendingDelete({ type, name: itemName })}
                    disabled={busyKey === `delete:${key}`}
                    className="min-h-10 rounded-lg bg-[var(--danger)]/20 px-3 py-1 text-xs text-[var(--danger)] transition hover:bg-[var(--danger)]/30 disabled:opacity-50"
                  >
                    {t("dockerResources.delete")}
                  </button>{" "}
                </div>{" "}
              </div>{" "}
            </div>
          );
        })}{" "}
      </div>
    );
  }
  return (
    <section data-card className="mb-6 p-4">
      {" "}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {" "}
        <div>
          {" "}
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t("dockerResources.title")}
          </h2>{" "}
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("dockerResources.desc")}
          </p>{" "}
        </div>{" "}
        <button
          type="button"
          onClick={() => void fetchResources()}
          disabled={loading}
          className="min-h-11 rounded-lg bg-[var(--surface-hover)]/50 px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {loading
            ? t("dockerResources.refreshBusy")
            : t("dockerResources.refresh")}
        </button>{" "}
      </div>{" "}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-[var(--danger)]/20 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}{" "}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {" "}
        <select
          value={activeType}
          onChange={(event) =>
            setActiveType(event.currentTarget.value as ResourceType)
          }
          className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)]"
        >
          <option value="networks">{t("dockerResources.kind.network")}</option>
          <option value="volumes">{t("dockerResources.kind.volume")}</option>
        </select>{" "}
        <input
          value={name}
          aria-label={t("dockerResources.field.name")}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder={t("dockerResources.field.name")}
          className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />{" "}
        <input
          value={driver}
          aria-label={t("dockerResources.field.driver")}
          onChange={(event) => setDriver(event.currentTarget.value)}
          placeholder={t("dockerResources.field.driver")}
          className="min-h-11 w-28 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />{" "}
        <button
          type="button"
          onClick={() => void createResource()}
          disabled={!name.trim() || Boolean(busyKey)}
          data-tone="accent"
          className="min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50"
        >
          {t("dockerResources.create")}
        </button>{" "}
      </div>{" "}
      <div className="grid gap-4 lg:grid-cols-2">
        {" "}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {formatCopy(t("dockerResources.group.networks"), {
              count: networks.length,
            })}
          </h3>
          {renderList("networks", networks)}
        </div>{" "}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {formatCopy(t("dockerResources.group.volumes"), {
              count: volumes.length,
            })}
          </h3>
          {renderList("volumes", volumes)}
        </div>{" "}
      </div>{" "}
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm"
          role="presentation"
        >
          {" "}
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="docker-resource-delete-title"
            className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]"
          >
            {" "}
            <h3
              id="docker-resource-delete-title"
              className="text-lg font-semibold text-[var(--text-primary)]"
            >
              {formatCopy(t("dockerResources.confirm.delete"), {
                kind: resourceKind(pendingDelete.type),
                name: pendingDelete.name,
              })}
            </h3>{" "}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {" "}
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              >
                {t("dockerResources.cancel")}
              </button>{" "}
              <button
                type="button"
                onClick={() => void confirmDeleteResource()}
                disabled={
                  busyKey ===
                  `delete:${pendingDelete.type}:${pendingDelete.name}`
                }
                className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger)]/80 disabled:opacity-60"
              >
                {t("dockerResources.confirm")}
              </button>{" "}
            </div>{" "}
          </section>{" "}
        </div>
      ) : null}{" "}
      {detail ? (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              {detail.title}
            </h3>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t("dockerResources.close")}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
            {detail.json}
          </pre>
        </div>
      ) : null}{" "}
    </section>
  );
}
