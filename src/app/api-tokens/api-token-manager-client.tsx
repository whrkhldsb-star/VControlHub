"use client";
import { StatCard } from "@/components/page-shell";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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

const scopeLabels: Record<string, string> = {
  read: "基础读取",
  "server:read": "VPS 读取",
  "storage:read": "云盘读取",
  "health:read": "健康监控",
  "status:read": "公开状态",
  "image:read": "图床读取",
  "image:write": "图床写入",
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function tokenStatus(token: SafeApiToken) {
  if (token.revokedAt) return { label: "已撤销", className: "border-rose-400/25 bg-rose-400/10 text-rose-200" };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: "已过期", className: "border-amber-400/25 bg-amber-400/10 text-amber-200" };
  }
  return { label: "有效", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" };
}

export function ApiTokenManagerClient({ initialTokens, allowedScopes }: Props) {
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
      setError(err instanceof Error ? err.message : "创建 Token 失败");
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
      setError(err instanceof Error ? err.message : "撤销 Token 失败");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
<StatCard label="Token 总数" value={tokens.length} />
					<StatCard label="当前有效" value={activeCount} accentColor="emerald" />
					<StatCard label="允许权限范围" value={allowedScopes.length} accentColor="cyan" />
      </div>

      {createdPlaintext && (
        <section className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-5 shadow-[0_20px_80px_rgba(251,191,36,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-amber-100">一次性明文 Token</h2>
              <p className="mt-1 text-sm text-amber-100/75/75">请立即复制，此明文 Token 离开页面后无法再次查看。</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(createdPlaintext)} className="rounded-xl border border-amber-200/25 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-200/10">
              复制 Token
            </button>
          </div>
          <code className="mt-4 block overflow-x-auto rounded-xl border border-amber-200/20 bg-slate-950/70 light:bg-white/70 p-3 font-mono text-xs text-amber-100">{createdPlaintext}</code>
        </section>
      )}

      {error && <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-4 py-3 text-sm text-rose-100">{error}</div>}

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">创建 API Token</h2>
        <p className="mt-1 text-sm text-slate-500">Token 仅在创建成功后显示一次；后端只保存哈希和脱敏标识。</p>
        <form onSubmit={createToken} className="mt-5 grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-white/50">Token 名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="例如：移动端 CLI / 监控脚本" data-card className="w-full  px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-cyan-400/30" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium tracking-wide text-white/50">过期时间（可选）</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} data-card className="w-full  px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30" />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-white/50">权限范围</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allowedScopes.map((scope) => (
                <label key={scope} aria-label={scope} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${selectedScopes.includes(scope) ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/[0.06] bg-white/[0.03] text-slate-400 hover:bg-white/[0.05]"}`}>
                  <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="h-4 w-4 accent-cyan-400" />
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="text-xs text-slate-500">{scopeLabels[scope] ?? scope}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button type="submit" disabled={submitting} className="rounded-2xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
              {submitting ? "创建中…" : "创建 Token"}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Token 列表</h2>
          <p className="text-xs text-slate-500">只展示前缀/尾缀，不展示哈希或明文。</p>
        </div>
        {tokens.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center text-sm text-slate-500">暂无 Token，请先创建用于脚本或外部集成的访问令牌。</div>
        ) : (
          <div className="grid gap-3">
            {tokens.map((token) => {
              const status = tokenStatus(token);
              return (
                <article key={token.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{token.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-slate-400">{token.tokenPrefix}…{token.tokenSuffix}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {token.scopes.map((scope) => <span key={scope} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-slate-400">{scope}</span>)}
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                        <div><dt className="text-slate-600">创建时间</dt><dd>{formatDate(token.createdAt)}</dd></div>
                        <div><dt className="text-slate-600">过期时间</dt><dd>{formatDate(token.expiresAt)}</dd></div>
                        <div><dt className="text-slate-600">最后使用</dt><dd>{formatDate(token.lastUsedAt)}</dd></div>
                      </dl>
                    </div>
                    {!token.revokedAt && (
                      <button type="button" aria-label={`撤销 ${token.name}`} disabled={revokingId === token.id} onClick={() => setTokenPendingRevoke(token)} className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-60">
                        {revokingId === token.id ? "撤销中…" : "撤销"}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 light:bg-white/70 px-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="revoke-api-token-title" className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-slate-950 light:bg-white p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
            <h2 id="revoke-api-token-title" className="text-lg font-semibold text-white">确认撤销 API Token</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              即将撤销 Token <span className="font-semibold text-rose-100">{tokenPendingRevoke.name}</span>。撤销后脚本、CLI 或外部集成将立即失去访问权限，且无法恢复。
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setTokenPendingRevoke(null)} className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.06]">
                取消
              </button>
              <button type="button" onClick={() => revokeToken(tokenPendingRevoke)} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400">
                确认撤销
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

