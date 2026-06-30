"use client";
import { EmptyState, StatCard } from "@/components/page-shell";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

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

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function tokenStatus(t: (k: string) => string, token: SafeApiToken) {
  if (token.revokedAt) return { label: t("apiTokensPage.status.revoked"), className: "border-rose-400/25 bg-rose-400/10 text-rose-200" };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: t("apiTokensPage.status.expired"), className: "border-amber-400/25 bg-amber-400/10 text-amber-200" };
  }
  return { label: t("apiTokensPage.status.active"), className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" };
}

function scopeLabel(t: (k: string) => string, scope: string): string {
  const translated = t(`apiTokensPage.scope.${scope}`);
  return translated === `apiTokensPage.scope.${scope}` ? scope : translated;
}

export function ApiTokenManagerClient({ initialTokens, allowedScopes }: Props) {
  const { t } = useI18n();
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
        <section className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-5 shadow-[0_20px_80px_rgba(251,191,36,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-amber-100">{t("apiTokensPage.plaintext.heading")}</h2>
              <p className="mt-1 text-sm text-amber-100/75">{t("apiTokensPage.plaintext.copyHint")}</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(createdPlaintext)} className="rounded-xl border border-amber-200/25 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-200/10">
              {t("apiTokensPage.plaintext.copy")}
            </button>
          </div>
          <code className="mt-4 block overflow-x-auto rounded-xl border border-amber-200/20 bg-slate-950/70 p-3 font-mono text-xs text-amber-100">{createdPlaintext}</code>
        </section>
      )}

      {error && <div data-tone="rose" className="rounded-xl border border-rose-400/25 px-4 py-3 text-sm text-rose-100">{error}</div>}

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">{t("apiTokensPage.create.heading")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("apiTokensPage.create.note")}</p>
        <form onSubmit={createToken} className="mt-5 grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-white/50">{t("apiTokensPage.create.nameLabel")}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={t("apiTokensPage.create.namePlaceholder")} data-card className="w-full  px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-cyan-400/30" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-white/50">{t("apiTokensPage.create.expiresLabel")}</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} data-card className="w-full  px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30" />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-white/50">{t("apiTokensPage.create.scopesLabel")}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allowedScopes.map((scope) => (
                <label key={scope} aria-label={scope} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${selectedScopes.includes(scope) ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/[0.06] bg-white/[0.03] text-slate-400 hover:bg-white/[0.05]"}`}>
                  <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="h-4 w-4 accent-cyan-400" />
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="text-xs text-slate-500">{scopeLabel(t, scope)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button type="submit" disabled={submitting} className="rounded-2xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
              {submitting ? t("apiTokensPage.create.submitting") : t("apiTokensPage.create.submit")}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{t("apiTokensPage.list.heading")}</h2>
          <p className="text-xs text-slate-500">{t("apiTokensPage.list.note")}</p>
        </div>
        {tokens.length === 0 ? (
          <EmptyState text={t("apiTokensPage.list.empty")} variant="boxed" />
        ) : (
          <div className="grid gap-3">
            {tokens.map((token) => {
              const status = tokenStatus(t, token);
              return (
 <article key={token.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{token.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-slate-400">{token.tokenPrefix}…{token.tokenSuffix}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {token.scopes.map((scope) => <span key={scope} className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-slate-400">{scope}</span>)}
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                        <div><dt className="text-slate-600">{t("apiTokensPage.list.createdAt")}</dt><dd>{formatDate(token.createdAt)}</dd></div>
                        <div><dt className="text-slate-600">{t("apiTokensPage.list.expiresAt")}</dt><dd>{formatDate(token.expiresAt)}</dd></div>
                        <div><dt className="text-slate-600">{t("apiTokensPage.list.lastUsedAt")}</dt><dd>{formatDate(token.lastUsedAt)}</dd></div>
                      </dl>
                    </div>
                    {!token.revokedAt && (
                      <button type="button" aria-label={t("apiTokensPage.revoke.aria").replace("{name}", token.name)} disabled={revokingId === token.id} onClick={() => setTokenPendingRevoke(token)} data-tone="rose" className="rounded-2xl border border-rose-400/30 px-4 py-2 text-xs font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-60">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="revoke-api-token-title" className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-slate-950 p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
            <h2 id="revoke-api-token-title" className="text-lg font-semibold text-white">{t("apiTokensPage.revoke.confirmTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {t("apiTokensPage.revoke.confirmBody").replace("{name}", tokenPendingRevoke.name)}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setTokenPendingRevoke(null)} className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.06]">
                {t("apiTokensPage.revoke.cancel")}
              </button>
              <button type="button" onClick={() => revokeToken(tokenPendingRevoke)} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400">
                {t("apiTokensPage.revoke.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
