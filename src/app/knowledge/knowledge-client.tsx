"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { PageShell, PageHeader, SurfacePanel, EmptyState } from "@/components/page-shell";

type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  updatedAt: string;
};

type DocumentRow = {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  chunkCount: number;
  updatedAt: string;
  errorMessage?: string | null;
};

type Hit = {
  knowledgeBaseName: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
  content: string;
};

export function KnowledgeClient({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadBases = useCallback(async () => {
    const data = await csrfFetch<{ knowledgeBases: KnowledgeBase[] }>("/api/knowledge");
    setBases(data.knowledgeBases ?? []);
    if (!selectedId && data.knowledgeBases?.[0]) {
      setSelectedId(data.knowledgeBases[0].id);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDocuments([]);
      return;
    }
    const data = await csrfFetch<{
      knowledgeBase: { documents: DocumentRow[] };
    }>(`/api/knowledge/${encodeURIComponent(id)}`);
    setDocuments(data.knowledgeBase?.documents ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await csrfFetch<{ knowledgeBases: KnowledgeBase[] }>("/api/knowledge");
        if (cancelled) return;
        setBases(data.knowledgeBases ?? []);
        if (data.knowledgeBases?.[0]) {
          setSelectedId((prev) => prev || data.knowledgeBases[0]!.id);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("knowledgePage.error"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await csrfFetch<{
          knowledgeBase: { documents: DocumentRow[] };
        }>(`/api/knowledge/${encodeURIComponent(selectedId)}`);
        if (!cancelled) setDocuments(data.knowledgeBase?.documents ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("knowledgePage.error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, t]);

  async function createBase() {
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      await csrfFetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_base",
          name,
          description: description || undefined,
        }),
      });
      setName("");
      setDescription("");
      setMessage(t("knowledgePage.created"));
      await loadBases();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("knowledgePage.error"));
    } finally {
      setBusy(null);
    }
  }

  async function ingest() {
    if (!selectedId) return;
    setBusy("ingest");
    setError(null);
    setMessage(null);
    try {
      const data = await csrfFetch<{ chunkCount: number }>("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ingest",
          knowledgeBaseId: selectedId,
          title: docTitle,
          content: docContent,
          sourceType: "MARKDOWN",
        }),
      });
      setDocTitle("");
      setDocContent("");
      setMessage(
        t("knowledgePage.ingested").replace("{count}", String(data.chunkCount ?? 0)),
      );
      await loadBases();
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("knowledgePage.error"));
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    setBusy("search");
    setError(null);
    setMessage(null);
    try {
      const data = await csrfFetch<{ hits: Hit[] }>("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          query,
          knowledgeBaseId: selectedId || undefined,
          limit: 5,
        }),
      });
      setHits(data.hits ?? []);
      setMessage(t("knowledgePage.searchOk").replace("{count}", String(data.hits?.length ?? 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("knowledgePage.error"));
    } finally {
      setBusy(null);
    }
  }

  async function removeDoc(documentId: string) {
    if (!canManage) return;
    setBusy(`del-${documentId}`);
    setError(null);
    try {
      await csrfFetch(`/api/knowledge?documentId=${encodeURIComponent(documentId)}`, {
        method: "DELETE",
      });
      await loadDetail(selectedId);
      await loadBases();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("knowledgePage.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("knowledgePage.eyebrow")}
        title={t("knowledgePage.title")}
        description={t("knowledgePage.description")}
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <SurfacePanel
          title={t("knowledgePage.basesTitle")}
          description={t("knowledgePage.basesDescription")}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                className={`${UI_INPUT} min-w-[10rem] flex-1`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("knowledgePage.namePlaceholder")}
              />
              <button
                type="button"
                disabled={!name.trim() || busy !== null}
                onClick={() => void createBase()}
                data-action-button data-variant="outline" className="!min-h-11 !px-3 !text-xs !font-semibold disabled:opacity-50"
              >
                {busy === "create" ? t("knowledgePage.working") : t("knowledgePage.create")}
              </button>
            </div>
            <input
              className={UI_INPUT}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("knowledgePage.descPlaceholder")}
            />
            {bases.length === 0 ? (
              <EmptyState text={t("knowledgePage.emptyBases")} />
            ) : (
              <ul className="space-y-2">
                {bases.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                        selectedId === b.id
                          ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
                          : "border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <div className="font-semibold">{b.name}</div>
                      <div className="mt-0.5 text-[11px] opacity-80">
                        {t("knowledgePage.baseMeta")
                          .replace("{docs}", String(b.documentCount))
                          .replace("{chunks}", String(b.chunkCount))}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SurfacePanel>

        <SurfacePanel
          title={t("knowledgePage.ingestTitle")}
          description={t("knowledgePage.ingestDescription")}
        >
          <div className="space-y-3">
            <input
              className={UI_INPUT}
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder={t("knowledgePage.docTitlePlaceholder")}
              disabled={!selectedId}
            />
            <textarea
              className={`${UI_INPUT} min-h-40 font-mono text-[11px]`}
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder={t("knowledgePage.docContentPlaceholder")}
              disabled={!selectedId}
            />
            <button
              type="button"
              disabled={!selectedId || !docTitle.trim() || !docContent.trim() || busy !== null}
              onClick={() => void ingest()}
              data-action-button data-variant="success" className="!min-h-11 !px-3 !text-xs !font-semibold disabled:opacity-50"
            >
              {busy === "ingest" ? t("knowledgePage.working") : t("knowledgePage.ingest")}
            </button>
            <div className="max-h-48 space-y-2 overflow-auto">
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border-subtle)] px-2 py-1.5 text-[11px]"
                >
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{d.title}</div>
                    <div className="text-[var(--text-muted)]">
                      {d.status} · {d.chunkCount} chunks
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      data-action-button data-variant="danger" className="!px-2 !py-1 !text-[11px]"
                      disabled={busy !== null}
                      onClick={() => void removeDoc(d.id)}
                    >
                      {t("knowledgePage.delete")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </SurfacePanel>
      </div>

      <SurfacePanel title={t("knowledgePage.searchTitle")} description={t("knowledgePage.searchDescription")}>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${UI_INPUT} min-w-[12rem] flex-1`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("knowledgePage.queryPlaceholder")}
          />
          <button
            type="button"
            disabled={!query.trim() || busy !== null}
            onClick={() => void search()}
            data-action-button data-variant="outline" className="!min-h-11 !px-3 !text-xs !font-semibold disabled:opacity-50"
          >
            {busy === "search" ? t("knowledgePage.working") : t("knowledgePage.search")}
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {hits.map((hit, idx) => (
            <article
              key={`${hit.documentTitle}-${hit.chunkIndex}-${idx}`}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 text-xs"
            >
              <div className="font-semibold text-[var(--text-primary)]">
                [{idx + 1}] {hit.knowledgeBaseName} / {hit.documentTitle}#{hit.chunkIndex}
                <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">
                  score {hit.score}
                </span>
              </div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[var(--text-secondary)]">
                {hit.content}
              </pre>
            </article>
          ))}
        </div>
      </SurfacePanel>

      {message && <p className="mt-3 text-xs text-[var(--success)]">{message}</p>}
      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
      <p className="mt-4 text-[11px] text-[var(--text-muted)]">{t("knowledgePage.aiHint")}</p>
    </PageShell>
  );
}
