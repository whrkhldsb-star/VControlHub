"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import {
  QUICK_SERVICE_PUBLIC_HOST,
  type AppSource,
  type CatalogItem,
  type DockerEnvironmentStatus,
} from "./quick-services-shared";

export type QuickServiceServerOption = {
  id: string;
  name: string;
  host: string;
};

type TFn = (key: string) => string;

export function useQuickServiceCatalog(t: TFn) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [remoteCatalog, setRemoteCatalog] = useState<CatalogItem[]>([]);
  const [sources, setSources] = useState<AppSource[]>([]);
  const [usedPorts, setUsedPorts] = useState<number[]>([]);
  const [dockerStatus, setDockerStatus] = useState<DockerEnvironmentStatus | null>(null);
  const [servers, setServers] = useState<QuickServiceServerOption[]>([]);
  /** empty string = hub-host */
  const [selectedServerId, setSelectedServerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [quickServicePublicHost, setQuickServicePublicHost] = useState(QUICK_SERVICE_PUBLIC_HOST);

  const fetchCatalog = useCallback(async () => {
    try {
      const qs = selectedServerId
        ? `?serverId=${encodeURIComponent(selectedServerId)}`
        : "";
      const data = await csrfFetch(`/api/quick-services${qs}`);
      setCatalog(data.catalog ?? []);
      setRemoteCatalog(data.remoteCatalog ?? []);
      setUsedPorts(Array.isArray(data.usedPorts) ? data.usedPorts : []);
      setDockerStatus(data.docker ?? null);
      if (Array.isArray(data.servers)) {
        setServers(
          data.servers.map((s: QuickServiceServerOption) => ({
            id: s.id,
            name: s.name,
            host: s.host,
          })),
        );
      }
      if (typeof data.publicHost === "string") setQuickServicePublicHost(data.publicHost);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("qsPage.loadFailedFallback"));
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, t]);

  const fetchSources = useCallback(async () => {
    try {
      const data = await csrfFetch("/api/app-sources?includeApps=false");
      setSources(data.sources ?? []);
    } catch {
      // silent
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- catalog bootstrap + hostName browser capability read. */
  useEffect(() => {
    setLoading(true);
    void fetchCatalog();
    void fetchSources();
  }, [fetchCatalog, fetchSources]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostName(window.location.hostname);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const allCatalog = [...catalog, ...remoteCatalog];
    const installing = allCatalog.filter((s) => s.status === "installing");
    if (installing.length === 0) return;
    const timer = setTimeout(() => {
      void fetchCatalog();
    }, 3000);
    return () => clearTimeout(timer);
  }, [catalog, remoteCatalog, fetchCatalog]);

  return {
    catalog,
    remoteCatalog,
    sources,
    usedPorts,
    dockerStatus,
    servers,
    selectedServerId,
    setSelectedServerId,
    loading,
    error,
    hostName,
    quickServicePublicHost,
    fetchCatalog,
    fetchSources,
  };
}
