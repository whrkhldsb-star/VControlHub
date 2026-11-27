"use client";
import { EmptyState, ListPanel, ListRow, PageHeader, StatCard, StatGrid, SurfacePanel } from "@/components/page-shell";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenStatus } from "@/lib/api-token/service";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Badge, CheckboxField, FormField, FormGrid, InlineLoading, Notice } from "@/components/ui-primitives";
import { Plus } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { copyText } from "@/lib/ui/clipboard";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

export type SafeApiToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenSuffix: string;
  scopes: string[];
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  teamId: string | null;
  team: { name: string; slug: string } | null;
};

type TokenPage = { tokens: SafeApiToken[]; total: number; nextCursor: string | null; totalTokens: number; activeTokens: number };
type TokenQuery = { status: TokenStatus; cursors: string[] };

type Props = {
  /** Page header; rendered here so the create command sits in its actions. */
  header?: { eyebrow?: string; title: string; description?: string };
  initialPage: TokenPage;
  pageSize: number;
  allowedScopes: readonly string[];
  currentCustomerName: string | null;
};

type Translate = (k: string, vars?: Record<string, string | number>) => string;

function tokenStatus(t: Translate, token: SafeApiToken) {
  if (token.revokedAt) return { label: t("apiTokensPage.status.revoked"), tone: "danger" as StatusTone };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: t("apiTokensPage.status.expired"), tone: "warning" as StatusTone };
  }
  if (!token.team) return { label: t("apiTokensPage.status.unbound"), tone: "warning" as StatusTone };
  return { label: t("apiTokensPage.status.active"), tone: "success" as StatusTone };
}

function scopeLabel(t: Translate, scope: string): string {
  const translated = t(`apiTokensPage.scope.${scope}`);
  return translated === `apiTokensPage.scope.${scope}` ? scope : translated;
}

/**
 * How to use the token just made: a request with a placeholder where the token goes, so copying the example
 * never puts the secret anywhere it was not meant to go, and the way to the API reference.
 */
function TokenUsageExample() {
  const { t } = useI18n();
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const example = `curl -H "Authorization: Bearer <TOKEN>" ${origin}/api/health`;
  return (
    <div className="mt-5 border-t border-[var(--warning-border)] pt-4">
      <h3 className="ui-title-group">{t("apiTokensPage.example.title")}</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("apiTokensPage.example.hint")}</p>
      <pre data-inset="" className="mt-3 overflow-x-auto p-3 font-mono text-xs text-[var(--text-primary)]"><code>{example}</code></pre>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton size="sm" variant="secondary" onClick={async () => setCopied((await copyText(example)) ? "copied" : "failed")}>
          {t("apiTokensPage.example.copy")}
        </ActionButton>
        <ButtonLink href="/api-docs" size="sm" variant="secondary">{t("apiTokensPage.example.docs")}</ButtonLink>
        {copied ? (
          <span role="status" className={`text-xs ${copied === "copied" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
            {t(copied === "copied" ? "apiTokensPage.plaintext.copied" : "apiTokensPage.example.copyFailed")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The fields of a new token; its panel (title, card) is the page's. A refusal is said here; a created token closes
 * the form and its plaintext is shown once, above it.
 */
function ApiTokenCreateForm({ allowedScopes, currentCustomerName, onCreated, onClose }: {
  allowedScopes: readonly string[];
  currentCustomerName: string | null;
  /** `close` is false when the fields were changed while the token was being created: a next one is being written. */
  onCreated: (plaintext: string, close: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read"]);
  const [expiresAt, setExpiresAt] = useState("");
  // What the fields hold now, read when the request answers (they stay editable while it runs).
  const latest = useRef({ name, expiresAt, scopes: selectedScopes });
  useEffect(() => {
    latest.current = { name, expiresAt, scopes: selectedScopes };
  }, [name, expiresAt, selectedScopes]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== "" || expiresAt !== "" || selectedScopes.join() !== "read";
  const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: onClose });

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope];
      return next.length > 0 ? next : ["read"];
    });
  };

  const createToken = async (event: React.FormEvent) => {
    event.preventDefault();
    const submitted = { name, expiresAt, scopes: selectedScopes.join() };
    setSubmitting(true);
    setError(null);
    try {
      // datetime-local is browser-local without offset; send absolute ISO so the
      // server does not reinterpret the string under a different TZ.
      const expiresAtIso = expiresAt
        ? (() => {
            const parsed = new Date(expiresAt);
            if (Number.isNaN(parsed.getTime())) {
              throw new Error(t("apiTokensPage.create.failed"));
            }
            return parsed.toISOString();
          })()
        : null;
      const data = await csrfFetch<{ token: string }>("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: selectedScopes, expiresAt: expiresAtIso }),
      });
      const now = latest.current;
      onCreated(data.token, now.name === submitted.name && now.expiresAt === submitted.expiresAt && now.scopes.join() === submitted.scopes);
    } catch (err) {
      setError(getErrorMessage(err, t("apiTokensPage.create.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={createToken} className="grid gap-4">
      {error ? <Notice tone="danger" compact>{error}</Notice> : null}
      <div className="space-y-1 text-sm">
        <p className="text-[var(--text-muted)]">{t("apiTokensPage.hint")}</p>
        {/* With no customer selected the page says so at its top, before the form is even opened. */}
        {currentCustomerName ? (
          <p className="text-[var(--text-secondary)]">{t("apiTokensPage.customer.active", { name: currentCustomerName })}</p>
        ) : null}
      </div>
      <FormGrid>
        <FormField label={t("apiTokensPage.create.nameLabel")} htmlFor="api-token-name">
          <input id="api-token-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={t("apiTokensPage.create.namePlaceholder")} className={UI_INPUT} />
        </FormField>
        <FormField label={t("apiTokensPage.create.expiresLabel")} htmlFor="api-token-expires">
          <input id="api-token-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={UI_INPUT} />
        </FormField>
      </FormGrid>

      <div className="space-y-2">
        <div className="text-xs font-medium text-[var(--text-primary)]/70">{t("apiTokensPage.create.scopesLabel")}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {allowedScopes.map((scope) => (
            <CheckboxField key={scope} aria-label={scope} checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} label={<span className="font-mono text-xs">{scope}</span>} hint={scopeLabel(t, scope)} className={`rounded-xl border px-3 py-2 transition ${selectedScopes.includes(scope) ? "border-[var(--accent-border)] bg-[var(--accent-bg)]" : "border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)]"}`} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <ActionButton variant="primary" type="submit" disabled={submitting || !currentCustomerName}>
          {submitting ? t("apiTokensPage.create.submitting") : t("apiTokensPage.create.submit")}
        </ActionButton>
        <ActionButton variant="secondary" type="button" disabled={submitting} onClick={requestDiscard}>
          {t("common.cancel")}
        </ActionButton>
      </div>
      {discardDialog}
    </form>
  );
}

export function ApiTokenManagerClient({ header, initialPage, pageSize, allowedScopes, currentCustomerName }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState<TokenQuery | null>(null);
  const [result, setResult] = useState<{ query: TokenQuery | null; page: TokenPage; error?: unknown }>({ query: null, page: initialPage });
  const { page } = result;
  const loading = result.query !== query;
  const status = query?.status ?? "all";
  const cursors = query?.cursors ?? [];

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const cursor = query.cursors.at(-1);
    const params = { status: query.status, pageSize: String(pageSize), ...(cursor ? { cursor } : {}) };
    csrfFetch<TokenPage>("/api/api-tokens", { params, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ query, page: data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult(previous => ({ ...previous, query, error }));
    });
    return () => controller.abort();
  }, [query, pageSize]);
  // Mutations can move rows across both filters and cursor boundaries.
  const refresh = useCallback(() => setQuery(current => ({ status: current?.status ?? "all", cursors: [] })), []);

  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  // The plaintext is shown once: whether the copy worked has to be said.
  const [copyOutcome, setCopyOutcome] = useState<"copied" | "failed" | null>(null);
  // A refused revoke is explained in its dialog: on the page it was covered by the dialog.
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [tokenPendingRevoke, setTokenPendingRevoke] = useState<SafeApiToken | null>(null);

  const closeForm = useCallback(() => setCreating(false), []);
  const openForm = !creating ? () => {
    setCreating(true);
    // A new token replaces the plaintext of the previous one.
    setCreatedPlaintext(null);
    setCopyOutcome(null);
  } : undefined;

  useEffect(() => {
    if (creating) panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [creating]);

  const handleCreated = useCallback((plaintext: string, close: boolean) => {
    refresh();
    setCreatedPlaintext(plaintext);
    setCopyOutcome(null);
    if (close) setCreating(false);
  }, [refresh]);

  const revokeToken = async (token: SafeApiToken) => {
    setRevokingId(token.id);
    setRevokeError(null);
    try {
      await csrfFetch(`/api/api-tokens?id=${encodeURIComponent(token.id)}`, { method: "DELETE" });
      refresh();
      setTokenPendingRevoke(null);
    } catch (err) {
      setRevokeError(getErrorMessage(err, t("apiTokensPage.revoke.failed")));
    } finally {
      setRevokingId(null);
    }
  };

  const listReady = !loading && !result.error;
  let empty;
  if (loading) {
    empty = <InlineLoading label={t("common.loading")} className="p-4" />;
  } else if (result.error) {
    empty = (
      <Notice tone="danger" compact>
        {getErrorMessage(result.error, t("apiTokensPage.list.failed"))}
        <ActionButton size="sm" variant="secondary" onClick={() => setQuery({ status, cursors })}>{t("common.retry")}</ActionButton>
      </Notice>
    );
  } else if (page.tokens.length === 0) {
    const emptyInventory = status === "all" && page.totalTokens === 0;
    empty = emptyInventory ? (
      <EmptyState title={t("apiTokensPage.list.emptyTitle")} text={t("apiTokensPage.list.emptyHint")}
        action={openForm && <ActionButton size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={openForm}>
          {t("apiTokensPage.create.heading")}
        </ActionButton>} />
    ) : <EmptyState title={t(cursors.length ? "apiTokensPage.list.emptyPage" : "apiTokensPage.list.noMatches")} />;
  }

  return (
    <div className="space-y-6">
      {header ? (
        <PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="">
          {openForm ? (
            <ActionButton icon={<Plus size={16} aria-hidden />} onClick={openForm}>
              {t("apiTokensPage.create.heading")}
            </ActionButton>
          ) : null}
        </PageHeader>
      ) : null}

      {currentCustomerName ? null : (
        <Notice tone="warning" title={t("apiTokensPage.customer.noneTitle")}>{t("apiTokensPage.customer.none")}</Notice>
      )}

      {createdPlaintext && (
        <section className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning)]/[0.10] p-5 shadow-[0_20px_80px_rgba(251,191,36,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="ui-title-section text-[var(--warning)]">{t("apiTokensPage.plaintext.heading")}</h2>
              <p className="mt-1 text-sm text-[var(--warning)]/75">{t("apiTokensPage.plaintext.copyHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="outline" onClick={async () => setCopyOutcome((await copyText(createdPlaintext)) ? "copied" : "failed")}>
                {t("apiTokensPage.plaintext.copy")}
              </ActionButton>
              <ActionButton variant="secondary" onClick={() => setCreatedPlaintext(null)}>
                {t("apiTokensPage.plaintext.dismiss")}
              </ActionButton>
            </div>
          </div>
          <code data-inset="" className="mt-4 block overflow-x-auto border-[var(--warning-border)] p-3 font-mono text-xs text-[var(--warning)] dark:text-[var(--warning)]">{createdPlaintext}</code>
          {copyOutcome ? (
            <p role="status" className={`mt-2 text-xs ${copyOutcome === "copied" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
              {t(copyOutcome === "copied" ? "apiTokensPage.plaintext.copied" : "apiTokensPage.plaintext.copyFailed")}
            </p>
          ) : null}
          <TokenUsageExample />
        </section>
      )}

      {creating ? (
        <div ref={panelRef} className="scroll-mt-24">
          <SurfacePanel title={t("apiTokensPage.create.heading")} description={t("apiTokensPage.create.note")}>
            <ApiTokenCreateForm
              allowedScopes={allowedScopes}
              currentCustomerName={currentCustomerName}
              onCreated={handleCreated}
              onClose={closeForm}
            />
          </SurfacePanel>
        </div>
      ) : null}

      <StatGrid cols={3}>
        <StatCard label={t("apiTokensPage.stat.total")} value={page.totalTokens} />
        <StatCard label={t("apiTokensPage.stat.active")} value={page.activeTokens} accentColor="emerald" />
        <StatCard label={t("apiTokensPage.stat.scopes")} value={allowedScopes.length} accentColor="cyan" />
      </StatGrid>

      <ListPanel
        title={t("apiTokensPage.list.heading")}
        count={listReady ? page.total : undefined}
        actions={<select className={UI_INPUT} aria-label={t("apiTokensPage.filter.status")} value={status}
          onChange={event => setQuery({ status: event.target.value as TokenStatus, cursors: [] })}>
          <option value="all">{t("apiTokensPage.filter.all")}</option>
          {(["active", "unbound", "expired", "revoked"] as const).map(value =>
            <option key={value} value={value}>{t(`apiTokensPage.status.${value}`)}</option>)}
        </select>}
        description={t("apiTokensPage.list.note")}
        empty={empty}
      >
        {listReady && page.tokens.map((token) => {
          const status = tokenStatus(t, token);
          return (
            <ListRow key={token.id} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="ui-title-group">{token.name}</h3>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <span className="text-xs text-[var(--text-muted)]">{t("apiTokensPage.customer.bound", { name: token.team?.name ?? "—" })}</span>
                </div>
                <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{token.tokenPrefix}…{token.tokenSuffix}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {token.scopes.map((scope) => <Badge className="font-mono" key={scope}>{scope}</Badge>)}
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-3">
                  <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.createdAt")}</dt><dd>{formatDateTime(token.createdAt, locale)}</dd></div>
                  <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.expiresAt")}</dt><dd>{formatDateTime(token.expiresAt, locale)}</dd></div>
                  <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.lastUsedAt")}</dt><dd>{formatDateTime(token.lastUsedAt, locale)}</dd></div>
                </dl>
              </div>
              {!token.revokedAt && (
                <ActionButton variant="danger" aria-label={t("apiTokensPage.revoke.aria", { name: token.name })} disabled={revokingId === token.id} onClick={() => { setRevokeError(null); setTokenPendingRevoke(token); }}>
                  {revokingId === token.id ? t("apiTokensPage.revoke.revoking") : t("apiTokensPage.revoke.button")}
                </ActionButton>
              )}
            </ListRow>
          );
        })}
      </ListPanel>
      {listReady && (page.nextCursor || cursors.length > 0) && (
        <nav aria-label={t("common.pagination.label")} className="flex gap-2">
          <ActionButton variant="secondary" disabled={!cursors.length}
            onClick={() => setQuery({ status, cursors: cursors.slice(0, -1) })}>{t("common.pagination.previous")}</ActionButton>
          <ActionButton variant="secondary" disabled={!page.nextCursor}
            onClick={() => page.nextCursor && setQuery({ status, cursors: [...cursors, page.nextCursor] })}>{t("common.pagination.next")}</ActionButton>
        </nav>
      )}
      <ConfirmDialog
        open={tokenPendingRevoke !== null}
        title={t("apiTokensPage.revoke.confirmTitle")}
        description={tokenPendingRevoke ? t("apiTokensPage.revoke.confirmBody", { name: tokenPendingRevoke.name }) : ""}
        cancelLabel={t("apiTokensPage.revoke.cancel")}
        confirmLabel={t("apiTokensPage.revoke.confirm")}
        busy={tokenPendingRevoke !== null && revokingId === tokenPendingRevoke.id}
        error={revokeError}
        onCancel={() => { setTokenPendingRevoke(null); setRevokeError(null); }}
        onConfirm={() => tokenPendingRevoke && revokeToken(tokenPendingRevoke)}
      />
    </div>
  );
}
