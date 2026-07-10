"use client";
import { EmptyState, StatCard } from "@/components/page-shell";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

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

function formatDate(value: Date | string | null, locale?: Locale) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(toDateLocale(locale ?? "zh"), { hour12: false });
}

function tokenStatus(t: (k: string) => string, token: SafeApiToken) {
  if (token.revokedAt) return { label: t("apiTokensPage.status.revoked"), className: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]" };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: t("apiTokensPage.status.expired"), className: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]" };
  }
  return { label: t("apiTokensPage.status.active"), className: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" };
}

function scopeLabel(t: (k: string) => string, scope: string): string {
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
  const revokeDialogRef = useDialogFocus({ open: !!tokenPendingRevoke, onClose: () => setTokenPendingRevoke(null) });

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
      const data = await csrfFetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: selectedScopes, expiresAt: expiresAt || null }),
		});
		setTokens((current) => [data.apiToken, ...current]);
      setCreatedPlaintext(data.token);
      setName("");
      setSelectedScopes(["read"]);
      setExpiresAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("apiTokensPage.create.failed"));
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
      setError(err instanceof Error ? err.message : t("apiTokensPage.revoke.failed"));
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
            <button type="button" onClick={() => navigator.clipboard?.writeText(createdPlaintext)} className="rounded-xl border border-[var(--warning-border)] px-3 py-2 text-xs font-medium text-[var(--warning)] hover:bg-[var(--warning-bg)]">
              {t("apiTokensPage.plaintext.copy")}
            </button>
          </div>
          <code className="mt-4 block overflow-x-auto rounded-xl border border-[var(--warning-border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--warning)] dark:text-[var(--warning)]">{createdPlaintext}</code>
        </section>
      )}

      {error && <div data-tone="rose" className="rounded-xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <section className="rounded-2xl border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] p-5">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("apiTokensPage.create.heading")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{t("apiTokensPage.create.note")}</p>
        <form onSubmit={createToken} className="mt-5 grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">{t("apiTokensPage.create.nameLabel")}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={t("apiTokensPage.create.namePlaceholder")} data-card className="w-full border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">{t("apiTokensPage.create.expiresLabel")}</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} data-card className="w-full border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-action-border)]/30" />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-[var(--text-primary)]/70">{t("apiTokensPage.create.scopesLabel")}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allowedScopes.map((scope) => (
                <label key={scope} aria-label={scope} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${selectedScopes.includes(scope) ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]" : "border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"}`}>
                  <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="h-4 w-4 accent-[var(--color-action)]" />
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="text-xs text-[var(--text-muted)]">{scopeLabel(t, scope)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button type="submit" disabled={submitting} className="rounded-2xl bg-[var(--color-action)] px-5 py-2.5 text-sm font-semibold text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:opacity-60">
              {submitting ? t("apiTokensPage.create.submitting") : t("apiTokensPage.create.submit")}
            </button>
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
 <article key={token.id} className="rounded-2xl border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{token.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{token.tokenPrefix}…{token.tokenSuffix}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {token.scopes.map((scope) => <span key={scope} className="rounded-lg border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{scope}</span>)}
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-3">
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.createdAt")}</dt><dd>{formatDate(token.createdAt)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.expiresAt")}</dt><dd>{formatDate(token.expiresAt)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{t("apiTokensPage.list.lastUsedAt")}</dt><dd>{formatDate(token.lastUsedAt)}</dd></div>
                      </dl>
                    </div>
                    {!token.revokedAt && (
                      <button type="button" aria-label={t("apiTokensPage.revoke.aria").replace("{name}", token.name)} disabled={revokingId === token.id} onClick={() => setTokenPendingRevoke(token)} data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] px-4 py-2 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-60">
                        {revokingId === token.id ? t("apiTokensPage.revoke.revoking") : t("apiTokensPage.revoke.button")}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {tokenPendingRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm" role="presentation" onClick={(event) => {
          if (event.target === event.currentTarget) setTokenPendingRevoke(null);
        }}>
          <section ref={revokeDialogRef} role="dialog" aria-modal="true" aria-labelledby="revoke-api-token-title" className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
            <h2 id="revoke-api-token-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("apiTokensPage.revoke.confirmTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              {t("apiTokensPage.revoke.confirmBody").replace("{name}", tokenPendingRevoke.name)}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setTokenPendingRevoke(null)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                {t("apiTokensPage.revoke.cancel")}
              </button>
              <button type="button" onClick={() => revokeToken(tokenPendingRevoke)} className="rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]">
                {t("apiTokensPage.revoke.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
