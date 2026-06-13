"use client";

import type { ConvItem, Provider, ModelCapabilities } from "./ai-types";

interface ChatHeaderProps {
	activeConv: ConvItem;
	activeProvider: Provider | null;
	currentModelCaps: ModelCapabilities;
	onToggleSidebar: () => void;
  onToggleSettings: () => void;
  onClearMessages: () => void;
  onRenameConv: () => void;
  onExportConv: () => void;
}

export function AiChatHeader({
  activeConv,
	activeProvider,
	currentModelCaps,
  onToggleSidebar,
  onToggleSettings,
  onClearMessages,
  onRenameConv,
  onExportConv,
}: ChatHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3 bg-slate-950/30">
      {/* Mobile sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="md:hidden flex-shrink-0 text-[var(--text-secondary)] hover:text-slate-200 light:hover:text-slate-800 transition"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-white truncate">{activeConv.title}</h3>
        <p className="text-[10px] text-slate-500">
          {activeProvider?.name || "未知"} · {activeConv.model}
          {activeConv.enableVision && " · 👁 多模态"}
          {currentModelCaps.video && " · 🎬 视频"}
          {currentModelCaps.audio && " · 🎵 音频"}
          {currentModelCaps.document && " · 📑 文档"}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onToggleSettings}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800 transition"
        >
          ⚙ 设置
        </button>
        <button
          onClick={onClearMessages}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-400 transition"
          title="清空对话消息"
        >
          🗑 清空
        </button>
        <button
          onClick={onRenameConv}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800 transition"
        >
          ✏ 重命名
        </button>
        <button
          onClick={onExportConv}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800 transition"
          title="导出对话为 Markdown"
        >
          📥 导出
        </button>
      </div>
    </div>
  );
}
