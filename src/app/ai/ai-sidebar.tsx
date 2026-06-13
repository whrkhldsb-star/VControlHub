"use client";

import type { ConvItem } from "./ai-types";
import { EmptyState } from "@/components/page-shell";

interface SidebarProps {
  showSidebar: boolean;
  conversations: ConvItem[];
  activeConvId: string | null;
  onNewConv: () => void;
  onSelectConv: (id: string) => void;
  onDeleteConv: (id: string) => void;
  onToggleSidebar: (v: boolean) => void;
  onToggleProviders: () => void;
}

export function AiSidebar({
  showSidebar,
  conversations,
  activeConvId,
  onNewConv,
  onSelectConv,
  onDeleteConv,
  onToggleSidebar,
  onToggleProviders,
}: SidebarProps) {
  return (
    <>
      {/* Mobile sidebar backdrop */}
      {showSidebar && (
        <div
          className="hidden max-md:block fixed inset-0 z-30 bg-black/50"
          onClick={() => onToggleSidebar(false)}
        />
      )}
      {showSidebar && (
        <div className="w-64 flex-shrink-0 border-r border-white/[0.06] bg-slate-950/50 flex flex-col max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">AI 助手</h2>
            <button
              onClick={onNewConv}
              className="h-7 px-2.5 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition"
            >
              + 新对话
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
            {conversations.length === 0 && (
              <EmptyState>暂无对话，点击新建开始</EmptyState>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition ${
 activeConvId === conv.id
 ?"bg-cyan-400/[0.08] text-cyan-100"
 :"text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800"
 }`}
                onClick={() => onSelectConv(conv.id)}
              >
                <svg className="w-4 h-4 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="text-xs truncate flex-1">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConv(conv.id);
                  }}
                  aria-label={`删除对话 ${conv.title}`}
                  className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="border-t border-white/[0.06] p-2 space-y-1">
            <button
              onClick={onToggleProviders}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" />
              </svg>
              提供商管理
            </button>
            <button
              onClick={() => onToggleSidebar(false)}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-800 transition lg:hidden"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              收起侧栏
            </button>
          </div>
        </div>
      )}

      {!showSidebar && (
        <button
          onClick={() => onToggleSidebar(true)}
          className="absolute top-4 left-4 z-50 lg:hidden rounded-xl border border-[var(--border)] bg-slate-950/90 p-2.5 text-slate-200 backdrop-blur hover:bg-white/10 transition"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </>
  );
}
