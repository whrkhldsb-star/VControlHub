"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { ModalShell } from "@/components/modal-shell";
import { ActionButton } from "@/components/action-button";
import { FormField, FormGrid, IconButton, Notice } from "@/components/ui-primitives";
import { cn } from "@/lib/ui/cn";
import { UI_INPUT } from "@/lib/ui/classes";
import { getErrorMessage } from "@/lib/http/error-message";
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
export function DockerResourcesPanel({ serverId }: { serverId?: string }) {
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

  const fetchGenRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const currentServerIdRef = useRef(serverId);
  useEffect(() => {
    currentServerIdRef.current = serverId;
  }, [serverId]);
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
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const gen = ++fetchGenRef.current;
    const serverAtFetch = serverId;
    setLoading(true);
    setError("");
    try {
      const [networkData, volumeData] = await Promise.all([
        csrfFetch(
          `/api/docker/resources?type=networks${serverAtFetch ? `&serverId=${serverAtFetch}` : ""}`,
          { signal: controller.signal } as RequestInit,
        ),
        csrfFetch(
          `/api/docker/resources?type=volumes${serverAtFetch ? `&serverId=${serverAtFetch}` : ""}`,
          { signal: controller.signal } as RequestInit,
        ),
      ]);
      if (gen !== fetchGenRef.current) return;
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
      if (gen !== fetchGenRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        getErrorMessage(err, t("dockerResources.error.load")),
      );
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [t, serverId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchResources();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      fetchAbortRef.current?.abort();
    };
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
          ...(serverId ? { serverId } : {}),
        }),
      });
      if (data.error) throw new Error(data.error);
      if (data && typeof data === "object" && data.ok === false) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : t("dockerResources.error.create"),
        );
      }
      setName("");
      if (currentServerIdRef.current === serverId) {
        await fetchResources();
      }
    } catch (err) {
      setError(
        getErrorMessage(err, t("dockerResources.error.create")),
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
        `/api/docker/resources?type=${type}&name=${encodeURIComponent(itemName)}${serverId ? `&serverId=${serverId}` : ""}`,
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
        getErrorMessage(err, t("dockerResources.error.inspect")),
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
        body: JSON.stringify({ type, action: "delete", name: itemName, ...(serverId ? { serverId } : {}) }),
      });
      if (data.error) throw new Error(data.error);
      if (data && typeof data === "object" && data.ok === false) {
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : t("dockerResources.error.delete"),
        );
      }
      setPendingDelete(null);
      if (currentServerIdRef.current === serverId) {
        await fetchResources();
      }
    } catch (err) {
      setError(
        getErrorMessage(err, t("dockerResources.error.delete")),
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
              className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3"
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
                  <ActionButton
                    type="button"
                    variant="ghost"
                    aria-label={formatCopy(t("dockerResources.inspectAria"), {
                      kind,
                      name: itemName,
                    })}
                    onClick={() => inspectResource(type, itemName)}
                    disabled={busyKey === `inspect:${key}`}
                    className="min-h-10 px-3 text-xs"
                  >
                    {t("dockerResources.inspect")}
                  </ActionButton>{" "}
                  <ActionButton
                    type="button"
                    variant="danger"
                    aria-label={formatCopy(t("dockerResources.deleteAria"), {
                      kind,
                      name: itemName,
                    })}
                    onClick={() => setPendingDelete({ type, name: itemName })}
                    disabled={busyKey === `delete:${key}`}
                    className="min-h-10 px-3 text-xs"
                  >
                    {t("dockerResources.delete")}
                  </ActionButton>{" "}
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
        <ActionButton variant="secondary"
          onClick={() => void fetchResources()}
          disabled={loading} className="!min-h-11 !px-3 !py-1.5 !text-xs disabled:opacity-50"
        >
          {loading
            ? t("dockerResources.refreshBusy")
            : t("dockerResources.refresh")}
        </ActionButton>{" "}
      </div>{" "}
      {error ? (
        <Notice
          tone="danger"
          className="mb-4"
          action={{ label: t("dockerResources.refresh"), onClick: () => void fetchResources(), disabled: loading }}
        >
          {error}
        </Notice>
      ) : null}{" "}
      <FormGrid columns={3} className="mb-4 items-end">
        <FormField label={t("dockerResources.title")} htmlFor="docker-resource-type">
          <select
            id="docker-resource-type"
            aria-label={t("dockerResources.title")}
            value={activeType}
            onChange={(event) =>
              setActiveType(event.currentTarget.value as ResourceType)
            }
            className={UI_INPUT}
          >
            <option value="networks">{t("dockerResources.kind.network")}</option>
            <option value="volumes">{t("dockerResources.kind.volume")}</option>
          </select>
        </FormField>
        <FormField label={t("dockerResources.field.name")} htmlFor="docker-resource-name">
          <input
            id="docker-resource-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={t("dockerResources.field.name")}
            className={UI_INPUT}
          />
        </FormField>
        <FormField label={t("dockerResources.field.driver")} htmlFor="docker-resource-driver">
          <input
            id="docker-resource-driver"
            value={driver}
            onChange={(event) => setDriver(event.currentTarget.value)}
            placeholder={t("dockerResources.field.driver")}
            className={cn(UI_INPUT, "font-mono")}
          />
        </FormField>
        <ActionButton variant="primary"
          onClick={() => void createResource()}
          disabled={!name.trim() || Boolean(busyKey)}
          className="!min-h-11 !px-4 !py-2 !text-sm disabled:opacity-50 md:col-start-3"
        >
          {t("dockerResources.create")}
        </ActionButton>
      </FormGrid>{" "}
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
        <ModalShell
          open={pendingDelete !== null}
          onClose={() => setPendingDelete(null)}
          labelledBy="docker-resource-delete-title"
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm"
          panelClassName="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]"
          closeOnBackdrop={false}
          as="section"
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
              <ActionButton variant="secondary"
                onClick={() => setPendingDelete(null)} className="min-h-11 !px-4 !py-2 !text-sm"
              >
                {t("dockerResources.cancel")}
              </ActionButton>{" "}
              <ActionButton variant="danger-solid"
                onClick={() => void confirmDeleteResource()}
                disabled={
                  busyKey ===
                  `delete:${pendingDelete.type}:${pendingDelete.name}`
                } className="min-h-11 !px-4 !py-2 !text-sm disabled:opacity-60"
              >
                {t("dockerResources.confirm")}
              </ActionButton>{" "}
            </div>{" "}
        </ModalShell>
      ) : null}{" "}
      {detail ? (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              {detail.title}
            </h3>
            <IconButton
              label={t("dockerResources.close")}
              onClick={() => setDetail(null)}
              className="h-8 w-8 text-base"
            >
              ×
            </IconButton>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
            {detail.json}
          </pre>
        </div>
      ) : null}{" "}
    </section>
  );
}
