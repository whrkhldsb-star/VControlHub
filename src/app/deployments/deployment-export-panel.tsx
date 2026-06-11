"use client";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type DeploymentExportFileMap = Record<string, string>;

type DeploymentExportResponse = {
  export?: {
    id?: string;
    name?: string;
    manifest?: {
      appName?: string;
      domain?: string;
      generatedAt?: string;
      dangerousEnvFlags?: string[];
    };
    files?: DeploymentExportFileMap;
  };
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAppName(value: string) {
  return value.trim().toLowerCase();
}

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DeploymentExportPanel() {
  const [domain, setDomain] = useState("");
  const [appName, setAppName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeploymentExportResponse["export"] | null>(null);

  const files = useMemo(() => Object.entries(result?.files ?? {}), [result]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const payload = {
        domain: normalizeDomain(domain) || undefined,
        appName: normalizeAppName(appName) || undefined,
      };
      const response = await csrfFetch("/api/deploy-export", {
        method: "POST",
        body: JSON.stringify(payload),
      }) as DeploymentExportResponse;
      setResult(response.export ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成部署导出包失败");
    } finally {
      setPending(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const slug = result.manifest?.appName || result.name || "deployment-export";
    downloadJsonFile(`${slug}-portable-deploy.json`, result);
  }

  return (
    <section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 light:border-slate-200 light:bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70 light:text-cyan-700">Portable Export</p>
          <h2 className="mt-1 text-sm font-semibold text-white">迁移部署导出包</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 light:text-slate-600">
            生成可审计的便携部署模板：环境变量示例、systemd 单元、Caddy 示例和部署脚本。导出内容只包含占位符，不会写入生产密钥或连接串。
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
          目标域名
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="console.example.com"
            className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:border-slate-200 light:bg-white light:placeholder:text-slate-400 light:text-slate-600"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
          应用标识
          <input
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            placeholder="vcontrolhub"
            className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:border-slate-200 light:bg-white light:placeholder:text-slate-400 light:text-slate-600"
          />
        </label>
        <button disabled={pending} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? "生成中..." : "生成导出包"}
        </button>
      </form>

      {error && <p role="alert" className="mt-3 text-xs text-rose-300 light:text-rose-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 light:bg-cyan-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{result.name ?? "portable deployment"}</h3>
              <p className="mt-1 text-xs text-slate-500 light:text-slate-600">
                {result.manifest?.domain ?? "example.com"} · {files.length} 个文件 · 危险演示开关默认关闭
              </p>
            </div>
            <button type="button" onClick={handleDownload} className="rounded-lg border border-cyan-300/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 light:text-cyan-800">
              下载 JSON
            </button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {files.map(([name, content]) => (
              <details key={name} className="rounded-lg border border-white/[0.06] bg-black/20 p-3 light:border-slate-200 light:bg-white">
                <summary className="cursor-pointer text-xs font-medium text-slate-300 light:text-slate-700">{name}</summary>
                <code className="mt-2 block max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-400 light:text-slate-600">{content}</code>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
