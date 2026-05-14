/* eslint-disable @next/next/no-img-element */
"use client";

import type { Provider } from "./ai-types";
import { PROVIDER_TYPES, COMMON_BASE_URLS } from "./ai-types";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";

export interface ProviderFormState {
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  availableModels: string;
  isDefault: boolean;
}

interface ProviderPanelProps {
  show: boolean;
  providers: Provider[];
  provForm: ProviderFormState;
  onClose: () => void;
  onCreateProvider: () => void;
  onDeleteProvider: (id: string) => void;
  onRefreshProviders: () => void;
  setProvForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
}

export function AiProviderPanel({
  show,
  providers,
  provForm,
  onClose,
  onCreateProvider,
  onDeleteProvider,
  onRefreshProviders,
  setProvForm,
}: ProviderPanelProps) {
	const { addToast } = useToast();
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">AI 提供商管理</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Existing providers */}
          {providers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider">已添加的提供商</h4>
              {providers.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-black/30 border border-white/5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{p.name}</span>
                      <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                        {PROVIDER_TYPES[p.type] || p.type}
                      </span>
                      {p.isDefault && (
                        <span className="text-[10px] text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded">默认</span>
                      )}
                      {!p.enabled && (
                        <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">已禁用</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {p.baseUrl} · {p.defaultModel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        try {
                          await csrfFetch(`/api/ai/providers/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ enabled: !p.enabled }),
                          });
                          onRefreshProviders();
                        } catch { /* ignore */ }
                      }}
                      className={`text-xs transition ${p.enabled ? "text-amber-400/60 hover:text-amber-400" : "text-green-400/60 hover:text-green-400"}`}
                    >
                      {p.enabled ? "禁用" : "启用"}
                    </button>
                    <button
                      onClick={async () => {
                        const newKey = prompt("输入新的 API Key（留空保持不变）:");
                        if (newKey === null) return;
                        const newUrl = prompt("Base URL:", p.baseUrl);
                        if (newUrl === null) return;
                        const newModel = prompt("默认模型:", p.defaultModel);
                        if (newModel === null) return;
                        const patchBody: Record<string, string> = {};
                        if (newKey?.trim()) patchBody.apiKey = newKey.trim();
                        if (newUrl !== p.baseUrl) patchBody.baseUrl = newUrl;
                        if (newModel !== p.defaultModel) patchBody.defaultModel = newModel;
                        if (Object.keys(patchBody).length > 0) {
                          try {
                            await csrfFetch(`/api/ai/providers/${p.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(patchBody),
                            });
                            onRefreshProviders();
                          } catch { addToast("error", "更新失败"); }
                        }
                      }}
                      className="text-xs text-cyan-400/60 hover:text-cyan-400 transition"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => onDeleteProvider(p.id)}
                      className="text-xs text-red-400/60 hover:text-red-400 transition"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add new provider form */}
          <div className="space-y-3">
            <h4 className="text-xs text-slate-500 uppercase tracking-wider">添加新提供商</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500">名称</label>
                <input
                  value={provForm.name}
                  onChange={(e) => setProvForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="如: OpenAI"
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">类型</label>
                <select
                  value={provForm.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    setProvForm((f) => ({
                      ...f,
                      type: t,
                      baseUrl: COMMON_BASE_URLS[t] || f.baseUrl,
                    }));
                  }}
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {Object.entries(PROVIDER_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-slate-500">API Key</label>
                <input
                  type="password"
                  value={provForm.apiKey}
                  onChange={(e) => setProvForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Base URL</label>
                <input
                  value={provForm.baseUrl}
                  onChange={(e) => setProvForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">默认模型</label>
                <input
                  value={provForm.defaultModel}
                  onChange={(e) => setProvForm((f) => ({ ...f, defaultModel: e.target.value }))}
                  placeholder="gpt-4o"
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-slate-500">
                  可用模型 (逗号分隔，留空则从 API 自动获取)
                </label>
                <input
                  value={provForm.availableModels}
                  onChange={(e) => setProvForm((f) => ({ ...f, availableModels: e.target.value }))}
                  placeholder="gpt-4o, gpt-4o-mini, o1-preview"
                  className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <label className="flex items-center gap-2 col-span-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={provForm.isDefault}
                  onChange={(e) => setProvForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  className="rounded border-white/20 bg-black/30 text-cyan-400 focus:ring-cyan-400/30"
                />
                <span className="text-xs text-slate-300">设为默认提供商</span>
              </label>
            </div>
            <button
              onClick={onCreateProvider}
              className="w-full h-9 rounded-xl bg-cyan-500/20 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition"
            >
              添加提供商
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
