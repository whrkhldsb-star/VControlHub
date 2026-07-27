"use client";
import { EmptyState, StatCard } from "@/components/page-shell";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { CheckboxField, FormField, FormGrid, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";

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
};

type Props = {
  initialTokens: SafeApiToken[];
  allowedScopes: readonly string[];
};

function tokenStatus(t: (k: string, vars?: Record<string, string | number>) => string, token: SafeApiToken) {
  if (token.revokedAt) return { label: t("apiTokensPage.status.revoked"), tone: "danger" as StatusTone };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: t("apiTokensPage.status.expired"), tone: "warning" as StatusTone };
  }
  return { label: t("apiTokensPage.status.active"), tone: "success" as StatusTone };
}

function scopeLabel(t: (k: string, vars?: Record<string, string | number>) => string, scope: string): string {
  const translated = t(`apiTokensPage.scope.${scope}`);
  return translated === `apiTokensPage.scope.${scope}` ? scope : translated;
}

export function ApiTokenManagerClient({ initialTokens, allowedScopes }: Props) {
  const { t, locale } = useI18n();
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  const [tokenPendingRevoke, setTokenPendingRevoke] = useState<SafeApiToken | null>(null);

  const activeCount = useMemo(() => tokens.filter((token) => !token.revokedAt).length, [tokens]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope];
      return next.length > 0 ? next : ["read"];
    });
  };

  const createToken = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedPlaintext(null);
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
      const data = await csrfFetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: selectedScopes, expiresAt: expiresAtIso }),
		});
		setTokens((current) => [data.apiToken, ...current]);
      setCreatedPlaintext(data.token);
      setName("");
      setSelectedScopes(["read"]);
      setExpiresAt("");
    } catch (err) {
      setError(getErrorMessage(err, t("apiTokensPage.create.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  const revokeToken = async (token: SafeApiToken) => {
    setRevokingId(token.id);
    setError(null);
    try {
      const data = await csrfFetch(`/api/api-tokens?id=${encodeURIComponent(token.id)}`, { method: "DELETE" });
      setTokens((current) => current.map((item) => (item.id === token.id ? { ...item, revokedAt: data.token?.revokedAt ?? new Date().toISOString() } : item)));
      setTokenPendingRevoke(null);
    } catch (err) {
      setError(getErrorMessage(err, t("apiTokensPage.revoke.failed")));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={t("apiTokensPage.stat.total")} value={tokens.length} />
        <StatCard label={t("apiTokensPage.stat.active")} value={activeCount} accentColor="emerald" />
        <StatCard label={t("apiTokensPage.stat.scopes")} value={allowedScopes.length} accentColor="cyan" />
      </div>

      {createdPlaintext && (
        <section className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning)]/[0.10] p-5 shadow-[0_20px_80px_rgba(251,191,36,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--warning)]">{t("apiTokensPage.plaintext.heading")}</h2>
              <p className="mt-1 text-sm text-[var(--warning)]/75">{t("apiTokensPage.plaintext.copyHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="outline" onClick={() => navigator.clipboard?.writeText(createdPlaintext)} className="!px-3 !py-2 !text-xs !font-medium">
                {t("apiTokensPage.plaintext.copy")}
              </ActionButton>
              <ActionButton variant="secondary" onClick={() => setCreatedPlaintext(null)} className="!px-3 !py-2 !text-xs !font-medium">
                {t("apiTokensPage.plaintext.dismiss")}
              </ActionButton>
            </div>
          </div>
          <code className="mt-4 block overflow-x-auto rounded-xl border border-[var(--warning-border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--warning)] dark:text-[var(--warning)]">{createdPlaintext}</code>
        </section>
      )}

      {error && <Notice tone="danger" onDismiss={() => setError(null)} dismissLabel={t("common.close")}>{error}</Notice>}

      <section data-card className="p-5">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("apiTokensPage.create.heading")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("apiTokensPage.create.note")}</p>
        <form onSubmit={createToken} className="mt-5 grid gap-4">
          <FormGrid>
            <FormField label={t("apiTokensPage.create.nameLabel")} htmlFor="api-token-name">
              <input id="api-token-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={t("apiTokensPage.create.namePlaceholder")} className={UI_INPUT} />
            </FormField>
            <FormField label={t("apiTokensPage.create.expiresLabel")} htmlFor="api-token-expires">
              <input id="api-token-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={UI_INPUT} />
            </FormField>
          </FormGrid>

          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">{t("apiTokensPage.create.scopesLabel")}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allowedScopes.map((scope) => (
                <CheckboxField key={scope} aria-label={scope} checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} label={<span className="font-mono text-xs">{scope}</span>} hint={scopeLabel(t, scope)} className={`rounded-xl border px-3 py-2 transition ${selectedScopes.includes(scope) ? "border-[var(--accent-border)] bg-[var(--accent-bg)]" : "border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)]"}`} />
              ))}
            </div>
          </div>

          <div>
            <ActionButton variant="primary" type="submit" disabled={submitting} className="px-5 py-2.5 text-sm">
              {submitting ? t("apiTokensPage.create.submitting") : t("apiTokensPage.create.submit")}
            </ActionButton>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("apiTokensPage.list.heading")}</h2>
          <p className="text-xs text-[var(--text-muted)]">{t("apiTokensPage.list.note")}</p>
        </div>
        {tokens.length === 0 ? (
          <EmptyState text={t("apiTokensPage.list.empty")} variant="boxed" />
        ) : (
          <div className="grid gap-3">
            {tokens.map((token) => {
              const status = tokenStatus(t, token);
              return (
 <article key={token.id} data-card className="p-5 transition hover:bg-[var(--surface-elevated)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{token.name}</h3>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{token.tokenPrefix}…{token.tokenSuffix}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {token.scopes.map((scope) => <span key={scope} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{scope}</span>)}
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-3">
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.createdAt")}</dt><dd>{formatDateTime(token.createdAt, locale)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.expiresAt")}</dt><dd>{formatDateTime(token.expiresAt, locale)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.lastUsedAt")}</dt><dd>{formatDateTime(token.lastUsedAt, locale)}</dd></div>
                      </dl>
                    </div>
                    {!token.revokedAt && (
                      <ActionButton variant="danger" aria-label={t("apiTokensPage.revoke.aria", { name: token.name })} disabled={revokingId === token.id} onClick={() => setTokenPendingRevoke(token)} className="!px-4 !py-2 !text-xs !font-medium disabled:opacity-60">
                        {revokingId === token.id ? t("apiTokensPage.revoke.revoking") : t("apiTokensPage.revoke.button")}
                      </ActionButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {tokenPendingRevoke && (
        <ModalShell
          open
          onClose={() => setTokenPendingRevoke(null)}
          labelledBy="revoke-api-token-title"
          as="section"
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm"
          panelClassName="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]"
        >
            <h2 id="revoke-api-token-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("apiTokensPage.revoke.confirmTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              {t("apiTokensPage.revoke.confirmBody", { name: tokenPendingRevoke.name })}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <ActionButton variant="secondary" onClick={() => setTokenPendingRevoke(null)} className="!px-4 !py-2 !text-sm">
                {t("apiTokensPage.revoke.cancel")}
              </ActionButton>
              <ActionButton variant="danger-solid" onClick={() => revokeToken(tokenPendingRevoke)} className="!px-4 !py-2 !text-sm">
                {t("apiTokensPage.revoke.confirm")}
              </ActionButton>
            </div>
        </ModalShell>
      )}
    </div>
  );
}
