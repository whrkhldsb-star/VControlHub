"use client";

import { useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

type AiHostedApprovalCardProps = {
  action: {
    id: string;
    actionName: string;
    actionType: string;
    riskLevel: string;
    params: unknown;
    createdAt?: Date | string;
    server?: { id: string; name: string; host: string } | null;
  };
};

function formatParams(params: unknown) {
  try {
    return JSON.stringify(params ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function riskLabel(riskLevel: string) {
  const normalized = riskLevel.toLowerCase();
  if (normalized === "critical") return "极高风险";
  if (normalized === "high") return "高风险";
  if (normalized === "medium") return "中风险";
  if (normalized === "low") return "低风险";
  return riskLevel;
}

export function AiHostedApprovalCard({ action }: AiHostedApprovalCardProps) {
  const [status, setStatus] = useState<"pending" | "approving" | "rejecting" | "approved" | "rejected">("pending");
  const [error, setError] = useState<string | null>(null);

  async function review(decision: "approve" | "reject") {
    setError(null);
    setStatus(decision === "approve" ? "approving" : "rejecting");
    try {
      await csrfFetch(`/api/ai/hosted-actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: decision }),
      });
      setStatus(decision === "approve" ? "approved" : "rejected");
    } catch (err) {
      setStatus("pending");
      setError(err instanceof Error ? err.message : "审批操作失败");
    }
  }

  const disabled = status !== "pending";

  return (
    <article className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-white light:text-slate-900">{action.actionName}</h3>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200 light:text-cyan-800">AI 助手授权</span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 light:text-amber-800">{riskLabel(action.riskLevel)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400 light:text-slate-600">需要你确认 AI 是否可以执行该高风险操作；只处理当前账号的 AI 托管请求。</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-400 light:text-slate-600 sm:grid-cols-2">
            <div className="rounded-lg border border-white/[0.05] bg-slate-950/40 light:bg-white/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-600">操作类型</div>
              <div className="mt-1 font-mono text-cyan-100 light:text-cyan-900">{action.actionType}</div>
            </div>
            <div className="rounded-lg border border-white/[0.05] bg-slate-950/40 light:bg-white/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-600">目标 VPS</div>
              <div className="mt-1 text-slate-200 light:text-slate-800">{action.server ? `${action.server.name} · ${action.server.host}` : "未指定"}</div>
            </div>
          </div>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-white/[0.05] bg-slate-950/60 light:bg-white/60 p-3 text-[11px] text-slate-300 light:text-slate-700">{formatParams(action.params)}</pre>
          {error ? <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => review("approve")}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "approving" ? "批准中…" : status === "approved" ? "已批准" : "批准 AI 执行"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => review("reject")}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 light:text-slate-800 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "rejecting" ? "拒绝中…" : status === "rejected" ? "已拒绝" : "拒绝"}
          </button>
        </div>
      </div>
    </article>
  );
}
