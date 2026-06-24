"use client";

import Image from "next/image";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Provider, ConvItem, Message, ToolCallEvent, ToolApprovalNeeded, ModelInfo } from "./ai-types";
import { DEFAULT_PROV_FORM, DEFAULT_SETTINGS_FORM } from "./ai-types";
import { formatAllowedTypes } from "./ai-file-helpers";
import { renderContent, copyToClipboard } from "./ai-markdown-renderer";
import { AiSidebar } from "./ai-sidebar";
import { AiChatHeader } from "./ai-chat-header";
import { AiSettingsPanelLazy } from "./ai-settings-panel-lazy";
import { AiProviderPanelLazy } from "./ai-provider-panel-lazy";
import { AiInputAreaLazy } from "./ai-input-area-lazy";
import { AiConfirmDialog } from "./ai-confirm-dialog";
import { useFileAttachments } from "./hooks/use-file-attachments";
import { useModelCapabilities } from "./hooks/use-model-capabilities";
import { useConversations } from "./hooks/use-conversations";
import { useToast } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

/* ── Main Component ─────────────────────────────────────────── */
export function AiClient({
	initialProviders,
	initialConversations,
}: {
	userId: string;
	initialProviders: Provider[];
	initialConversations: ConvItem[];
}) {
 const { t } = useI18n();
 const { addToast } = useToast();
 const [providers, setProviders] = useState(initialProviders);
  // Conversation + active id + messages now live in useConversations
  // (R24); the client still writes the message list directly during
  // streaming via the returned `setMessages`.
  const {
    conversations,
    activeConvId,
    setActiveConvId,
    activeConv,
    messages,
    setMessages,
    refreshConversations,
    autoTitle,
  } = useConversations({ initialConversations });
  const [input, setInput] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [showProviders, setShowProviders] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<ToolApprovalNeeded[]>([]);
  const [approvalBusyById, setApprovalBusyById] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { type: "delete-conversation"; id: string; title: string }
    | { type: "delete-provider"; id: string; name: string }
    | { type: "clear-messages" }
    | null
  >(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
 const [renameDialogOpen, setRenameDialogOpen] = useState(false);
 const [renameTitle, setRenameTitle] = useState("");
 const [renameBusy, setRenameBusy] = useState(false);
 const [renameError, setRenameError] = useState<string | null>(null);
 const messagesEndRef = useRef<HTMLDivElement | null>(null);
 const fileInputRef = useRef<HTMLInputElement | null>(null);
 const textareaRef = useRef<HTMLTextAreaElement | null>(null);
 const abortControllerRef = useRef<AbortController | null>(null);
 const approvalBusyRef = useRef<Set<string>>(new Set());

  // activeConv now comes from useConversations (R24)
  const activeProvider = activeConv
    ? providers.find((p) => p.id === activeConv.providerId)
    : null;

  // Resolve current model capabilities (from API list first, fallback to client detection)
  const { caps: currentModelCaps, supportsVision: currentModelSupportsVision } = useModelCapabilities(
    activeConv?.model,
    modelList
  );

  // File attachments — capability-aware selection / paste / drop
  const {
    fileAttachments,
    setFileAttachments,
    fileRejectionMsg,
    clearRejection,
    handleFileSelect,
    handlePaste,
    handleDrop,
    handleDragOver,
  } = useFileAttachments({
    currentModelCaps,
    modelName: activeConv?.model,
    enableVision: activeConv?.enableVision,
    onReject: (msg) => addToast("error", msg),
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent, streamReasoning]);

  // Fetch messages when conversation changes — moved to useConversations (R24)

  // Fetch models when provider changes
	const fetchModels = useCallback(async (providerId: string) => {
		setModelsLoading(true);
		try {
			const data = await csrfFetch(`/api/ai/models?providerId=${providerId}`);
			if (data.models) setModelList(data.models);
		} catch {
			setModelList([]);
		} finally {
			setModelsLoading(false);
		}
	}, []);


  useEffect(() => {
    if (activeConv?.providerId) {
      fetchModels(activeConv.providerId);
    } else {
      setModelList([]);
    }
  }, [activeConv?.providerId, fetchModels]);

  // Refresh conversation list — moved to useConversations (R24)
  // refreshProviders stays here because it manages the local `providers` state.

	const refreshProviders = useCallback(async () => {
		const data = await csrfFetch("/api/ai/providers");
		if (data.providers) setProviders(data.providers);
	}, []);

  const refreshActiveMessages = useCallback(async () => {
    if (!activeConvId) return;
    const data = await csrfFetch(`/api/ai/conversations/${activeConvId}`);
    if (data.conversation?.messages) setMessages(data.conversation.messages);
  }, [activeConvId, setMessages]);

  const handleHostedActionDecision = useCallback(async (approval: ToolApprovalNeeded, action: "confirm" | "reject") => {
    if (approvalBusyRef.current.has(approval.actionId)) return;
    approvalBusyRef.current.add(approval.actionId);
    setApprovalBusyById((prev) => ({ ...prev, [approval.actionId]: true }));
    try {
      await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { action, reason: t("aiPage.userDenied") } : { action }),
      });
      setPendingApprovals((prev) => prev.filter((item) => item.actionId !== approval.actionId));
      await refreshActiveMessages();
      addToast("success", action === "reject" ? t("aiPage.rejected") : t("aiPage.approved"));
    } catch {
      addToast("error", t("aiPage.opFailed"));
    } finally {
      approvalBusyRef.current.delete(approval.actionId);
      setApprovalBusyById((prev) => {
        const { [approval.actionId]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
    }
  }, [addToast, refreshActiveMessages, t]);

  /* ── File Handling (capability-aware) ─────────────────────── */
  // Logic moved to hooks/use-file-attachments.ts; exposed below.



  /* ── Stop Generation ─────────────────────────────────────────── */
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
		// Re-fetch to get the partial saved message from server
		if (activeConvId) {
			csrfFetch(`/api/ai/conversations/${activeConvId}`)
				.then((data) => {
					if (data.conversation?.messages) setMessages(data.conversation.messages);
				})
				.catch(() => {});
		}
	};

  /* ── Send Message ──────────────────────────────────────────── */
  const handleSend = async () => {
    if (!activeConvId || streaming) return;
    // Require either text input or file attachments
    if (!input.trim() && fileAttachments.length === 0) return;
    const userMsg = input.trim() || t("aiPage.attachmentHint");
    const userImages = [...imageUrls];
    const userImageBase64 = fileAttachments
      .filter((f) => f.type === "image" && f.base64Data)
      .map((f) => ({ mimeType: f.mimeType, data: f.base64Data! }));
    const userFiles = fileAttachments
      .filter((f) => f.type === "text")
      .map((f) => ({ name: f.name, content: f.content }));
    const userImagePreviews = fileAttachments
      .filter((f) => f.type === "image" && f.preview)
      .map((f) => f.preview!);

  setInput("");
  setImageUrls([]);
  setFileAttachments([]);

  // Set up abort controller for stop generation
  const abortController = new AbortController();
  abortControllerRef.current = abortController;

  // Add optimistic user message
    const optimisticUser: Message = {
      id: `temp-${crypto.randomUUID()}`,
      conversationId: activeConvId,
      role: "user",
      content: userMsg,
      reasoningContent: null,
      imageUrls: JSON.stringify([...userImages, ...userImagePreviews]),
      model: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      createdAt: new Date().toISOString(),
    };
  setMessages((prev) => [...prev, optimisticUser]);
  setStreaming(true);
  setStreamContent("");
  setStreamReasoning("");

  // Auto-title on first message
  if (messages.length === 0) {
    autoTitle(activeConvId, userMsg);
  }

 try {
 // Use raw mode for SSE streaming — csrfFetch returns Response, not parsed JSON
 const response = await csrfFetch<Response>("/api/ai/chat", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 conversationId: activeConvId,
 content: userMsg,
 imageUrls: userImages,
 imageBase64: userImageBase64,
 fileAttachments: userFiles,
 }),
 signal: abortController.signal,
 raw: true,
});

 if (!response.ok) {
 const err = await response.json().catch(() => ({ error: t("aiPage.requestFailed") }));
 setStreamContent(`❌ ${err.error || t("aiPage.requestFailed")}`);
 setStreaming(false);
 return;
 }

 const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      let finalContent = "";
      let finalReasoning = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content") {
              finalContent += parsed.content;
              setStreamContent(finalContent);
            } else if (parsed.type === "reasoning") {
              finalReasoning += parsed.content;
              setStreamReasoning(finalReasoning);
            } else if (parsed.type === "done") {
              const assistantMsg: Message = {
                id: `stream-${crypto.randomUUID()}`,
                conversationId: activeConvId,
                role: "assistant",
                content: finalContent || t("aiPage.noResponse"),
                reasoningContent: finalReasoning || null,
                imageUrls: "[]",
                model: activeConv?.model || null,
                inputTokens: parsed.inputTokens ?? null,
                outputTokens: parsed.outputTokens ?? null,
                latencyMs: parsed.latencyMs ?? null,
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
 } else if (parsed.type === "error") {
  setStreamContent(`❌ ${parsed.error}`);
 } else if (parsed.type === "tool_call") {
  // AI 发起了工具调用
  const tc = parsed.toolCall as ToolCallEvent;
  if (tc.autoApproved) {
   setStreamContent((prev) => prev + t("aiPage.toolCallStart").replace("{name}", tc.actionName));
  } else {
   setStreamContent((prev) => prev + t("aiPage.toolCallApproval").replace("{name}", tc.actionName));
  }
  } else if (parsed.type === "tool_result") {
  // 工具执行结果
  const success = parsed.success as boolean;
  if (success) {
   setStreamContent((prev) => prev + t("aiPage.toolCallSuccess"));
  } else {
   setStreamContent((prev) => prev + t("aiPage.toolCallFailed").replace("{detail}", JSON.stringify(parsed.data).slice(0, 200)));
  }
  } else if (parsed.type === "tool_approval_needed") {
  // 需要审批的操作
  const approval = parsed as ToolApprovalNeeded;
  setPendingApprovals((prev) => [...prev, approval]);
  setStreamContent((prev) => prev + t("aiPage.waitingApproval").replace("{name}", approval.actionName).replace("{risk}", approval.riskLevel));
  }
          } catch {
            // Skip
          }
        }
      }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // User stopped generation — don't show error
    } else {
      setStreamContent(t("aiPage.networkError"));
    }
  } finally {
    setStreaming(false);
    setStreamContent("");
    setStreamReasoning("");
    abortControllerRef.current = null;
      if (activeConvId) {
        csrfFetch(`/api/ai/conversations/${activeConvId}`)
          
          .then((data) => {
            if (data.conversation?.messages) setMessages(data.conversation.messages);
          })
          .catch(() => {});
      }
      refreshConversations();
    }
  };

  /* ── Create New Conversation ──────────────────────────────── */
  const handleNewConv = async () => {
    const defaultProvider = providers.find((p) => p.isDefault && p.enabled) || providers.find((p) => p.enabled);
    if (!defaultProvider) {
      addToast("error", t("aiPage.noProviderToast"));
      setShowProviders(true);
      return;
    }
    try {
      const data = await csrfFetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: defaultProvider.id,
          model: defaultProvider.defaultModel,
        }),
      });
if (data.conversation) {
        await refreshConversations();
        setActiveConvId(data.conversation.id);
      }
    } catch {
      addToast("error", t("aiPage.createConvFailed"));
    }
  };

  /* ── Auto-title moved to useConversations.autoTitle (R24) ── */

  /* ── Delete Conversation ──────────────────────────────────── */
  const handleDeleteConv = (id: string) => {
    const target = conversations.find((conv) => conv.id === id);
    setConfirmError(null);
    setConfirmAction({ type: "delete-conversation", id, title: target?.title ?? t("aiPage.fallbackConvName") });
  };

  /* ── Provider Form State ────────────────────────────────────── */
  const [provForm, setProvForm] = useState(DEFAULT_PROV_FORM);

  const handleCreateProvider = async () => {
    if (!provForm.name.trim() || !provForm.apiKey.trim()) {
      addToast("error", t("aiPage.nameAndKeyRequired"));
      return;
    }
    const baseUrl = provForm.baseUrl.trim();
    const models = provForm.availableModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    try {
      await csrfFetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...provForm,
          ...(baseUrl ? { baseUrl } : {}),
          models: models.join(","),
          availableModels: models,
        }),
      });
      await refreshProviders();
      setProvForm({
        name: "",
        type: "OPENAI_COMPATIBLE",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
        availableModels: "",
        isDefault: true,
      });
    } catch {
      addToast("error", t("aiPage.addProviderFailed"));
    }
  };

  const handleDeleteProvider = (id: string) => {
    const target = providers.find((provider) => provider.id === id);
    setConfirmError(null);
    setConfirmAction({ type: "delete-provider", id, name: target?.name ?? t("aiPage.fallbackProviderName") });
  };

  const confirmDialogCopy = (() => {
    if (!confirmAction) return null;
    if (confirmAction.type === "delete-conversation") {
      return {
        title: t("aiPage.deleteConvTitle"),
        confirmLabel: t("aiPage.confirmDelete"),
        description: (
          <>
            {t("aiPage.deleteConvBody").replace("{title}", confirmAction.title)}
          </>
        ),
      };
    }
    if (confirmAction.type === "delete-provider") {
      return {
        title: t("aiPage.deleteProviderTitle"),
        confirmLabel: t("aiPage.confirmDelete"),
        description: (
          <>
            {t("aiPage.deleteProviderBody").replace("{name}", confirmAction.name)}
          </>
        ),
      };
    }
    return {
      title: t("aiPage.clearMessagesTitle2"),
      confirmLabel: t("aiPage.confirmClear"),
      description: t("aiPage.clearMessagesBody"),
    };
  })();

  const closeConfirmDialog = () => {
    if (confirmBusy) return;
    setConfirmAction(null);
    setConfirmError(null);
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (confirmAction.type === "delete-conversation") {
        await csrfFetch(`/api/ai/conversations/${confirmAction.id}`, { method: "DELETE" });
        if (activeConvId === confirmAction.id) setActiveConvId(null);
        await refreshConversations();
      } else if (confirmAction.type === "delete-provider") {
        await csrfFetch(`/api/ai/providers/${confirmAction.id}`, { method: "DELETE" });
        if (activeConv?.providerId === confirmAction.id) setActiveConvId(null);
        await refreshProviders();
        await refreshConversations();
      } else if (activeConvId) {
        await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearMessages: true }),
        });
        setMessages([]);
      }
      setConfirmAction(null);
    } catch (e: unknown) {
      const fallback = confirmAction.type === "clear-messages" ? t("aiPage.clearFailedFallback") : t("aiPage.deleteFailedFallback");
      setConfirmError(e instanceof Error ? e.message : fallback);
    } finally {
      setConfirmBusy(false);
    }
  };

  /* ── Settings Update ───────────────────────────────────────── */

  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS_FORM);

  useEffect(() => {
    if (activeConv) {
      setSettingsForm({
        model: activeConv.model,
        systemPrompt: activeConv.systemPrompt || "",
        temperature: activeConv.temperature,
        maxTokens: activeConv.maxTokens,
        topP: activeConv.topP,
        frequencyPenalty: activeConv.frequencyPenalty,
        presencePenalty: activeConv.presencePenalty,
 enableVision: activeConv.enableVision,
 hostingEnabled: activeConv.hostingEnabled,
 });
    }
  }, [activeConv]);

  const handleSaveSettings = async () => {
    if (!activeConvId) return;
    try {
      await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      await refreshConversations();
      setShowSettings(false);
    } catch {
      addToast("error", t("aiPage.saveFailed"));
    }
  };

  const openRenameDialog = () => {
    if (!activeConv) return;
    setRenameTitle(activeConv.title);
    setRenameError(null);
    setRenameDialogOpen(true);
  };

  const handleRenameConversation = async () => {
    if (!activeConvId) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle) {
      setRenameError(t("aiPage.saveTitlePrompt"));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      await refreshConversations();
      setRenameDialogOpen(false);
      addToast("success", t("aiPage.titleUpdated"));
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t("aiPage.renameFailed"));
    } finally {
      setRenameBusy(false);
    }
  };

	return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {confirmDialogCopy && (
        <AiConfirmDialog
          open
          title={confirmDialogCopy.title}
          description={confirmDialogCopy.description}
          confirmLabel={confirmDialogCopy.confirmLabel}
          error={confirmError}
          busy={confirmBusy}
          onCancel={closeConfirmDialog}
          onConfirm={runConfirmedAction}
        />
      )}
      {renameDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-conversation-title"
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-slate-950 p-5 shadow-2xl"
          >
            <h3 id="rename-conversation-title" className="text-sm font-semibold text-white">{t("aiPage.renameTitle")}</h3>
            <label htmlFor="rename-conversation-title-input" className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]">
              {t("aiPage.newTitleLabel")}
              <input
                id="rename-conversation-title-input"
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                autoFocus
                className="rounded-xl border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
                placeholder={t("aiPage.newTitlePlaceholder")}
              />
            </label>
            {renameError && <p role="alert" className="mt-3 text-xs text-rose-300">{renameError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={renameBusy}
                onClick={() => { setRenameDialogOpen(false); setRenameError(null); }}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-white/5 disabled:opacity-50"
              >
                {t("aiPage.cancel")}
              </button>
              <button
                type="button"
                disabled={renameBusy || !renameTitle.trim()}
                onClick={handleRenameConversation}
                className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {renameBusy ? t("aiPage.savingLabel") : t("aiPage.saveTitleLabel")}
              </button>
            </div>
          </div>
        </div>
      )}
      <AiSidebar
        showSidebar={showSidebar}
        conversations={conversations}
        activeConvId={activeConvId}
        onNewConv={handleNewConv}
        onSelectConv={setActiveConvId}
        onDeleteConv={handleDeleteConv}
        onToggleSidebar={setShowSidebar}
        onToggleProviders={() => setShowProviders(!showProviders)}
      />
      {/* ── Main Chat Area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
      {activeConv ? (
        <>
        {/* Chat header */}
        <AiChatHeader
          activeConv={activeConv}
          activeProvider={activeProvider ?? null}
          currentModelCaps={currentModelCaps}
          onToggleSidebar={() => setShowSidebar(true)}
          onToggleSettings={() => setShowSettings(!showSettings)}
          onClearMessages={() => {
            setConfirmError(null);
            setConfirmAction({ type: "clear-messages" });
          }}
          onRenameConv={openRenameDialog}
          onExportConv={async () => {
            try {
              const data = await csrfFetch(`/api/ai/conversations/${activeConvId}`);
const conv = data.conversation;
              if (!conv) return;
              const exportText = [
                `# ${conv.title}`,
                t("aiPage.modelMeta").replace("{model}", conv.model).replace("{provider}", activeProvider?.name || t("aiPage.modelUnknown")),
                t("aiPage.createdMeta").replace("{date}", conv.createdAt),
                "",
                ...conv.messages.map((m: Message) => {
                  const role = m.role === "user" ? t("aiPage.roleUser") : m.role === "assistant" ? t("aiPage.roleAssistant") : t("aiPage.roleSystem");
                  return `---\n${role}:\n\n${m.content}\n`;
                }),
              ].join("\n");
              const blob = new Blob([exportText], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${conv.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`;
              a.click();
              URL.revokeObjectURL(url);
            } catch { /* ignore */ }
          }}
        />
        {/* Settings panel — TR-036 lazy chunk, only fetched when showSettings */}
        <AiSettingsPanelLazy
          show={showSettings}
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
          modelList={modelList}
          modelsLoading={modelsLoading}
          modelDropdownOpen={modelDropdownOpen}
          setModelDropdownOpen={setModelDropdownOpen}
          modelSearch={modelSearch}
          setModelSearch={setModelSearch}
          currentModelSupportsVision={currentModelSupportsVision}
          onSaveSettings={handleSaveSettings}
          onRefreshModels={() => activeConv?.providerId && fetchModels(activeConv.providerId)}
        />
            {/* Messages area */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              {messages.length === 0 && !streaming && (
                <div className="flex flex-col items-center justify-center h-full text-slate-600">
                  <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm">{t("aiPage.placeholder")}</p>
                  <p className="text-xs mt-1 text-slate-700">
                    {t("aiPage.dragPasteHint").replace("{types}", formatAllowedTypes(currentModelCaps))}
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role !== "user" && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25" />
                      </svg>
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-cyan-500/15 text-cyan-50"
                        : "bg-white/[0.04] text-slate-200"
                    }`}
                  >
                    {/* Reasoning content */}
                    {msg.reasoningContent && (
                      <details className="mb-2">
                        <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400">
                          {t("aiPage.thinkingProcess")}
                        </summary>
                        <div className="mt-1 p-2 bg-black/20 rounded-lg text-xs text-slate-500 whitespace-pre-wrap">
                          {msg.reasoningContent}
                        </div>
                      </details>
                    )}
 {/* Main content */}
 <div className="break-words">{renderContent(msg.content)}</div>
                    {/* Image URLs */}
                    {(() => {
                      try {
                        const urls: string[] = JSON.parse(msg.imageUrls || "[]");
                        if (urls.length === 0) return null;
return (
						<div className="flex flex-wrap gap-2 mt-2">
							{urls.map((url, i) => (
								<Image
									key={i}
									src={url}
									alt={t("aiPage.attachment").replace("{index}", String(i + 1))}
									width={200}
									height={200}
									unoptimized
									className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-[var(--border)]"
									onError={(e) => {
										(e.currentTarget as HTMLImageElement).style.display = "none";
									}}
								/>
							))}
						</div>
					);
                      } catch {
                        return null;
                      }
                    })()}
  {/* Meta info */}
  {msg.role === "assistant" && (msg.inputTokens || msg.outputTokens || msg.latencyMs) && (
    <div className="mt-2 flex gap-3 text-[10px] text-slate-600">
      {msg.model && <span>{msg.model}</span>}
      {msg.inputTokens != null && <span>↑{msg.inputTokens}</span>}
      {msg.outputTokens != null && <span>↓{msg.outputTokens}</span>}
      {msg.latencyMs != null && <span>{(msg.latencyMs / 1000).toFixed(1)}s</span>}
    </div>
  )}
  {/* Copy message button */}
  <button
    onClick={async () => {
      const ok = await copyToClipboard(msg.content);
      if (ok) {
        setCopyFeedback(msg.id);
        setTimeout(() => setCopyFeedback(null), 2000);
      }
    }}
    className="mt-1.5 text-[10px] text-slate-600 hover:text-cyan-400 transition flex items-center gap-1"
  >
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
    {copyFeedback === msg.id ? t("aiPage.copyOrCopied") : t("aiPage.copy")}
  </button>
                  </div>
                  {msg.role === "user" && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center text-[11px] font-semibold text-cyan-400 uppercase">
                      U
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming content */}
              {streaming && streamContent && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5" />
                    </svg>
                  </div>
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-white/[0.04] text-slate-200 text-sm leading-relaxed">
                    {streamReasoning && (
                      <details open className="mb-2">
                        <summary className="text-[10px] text-cyan-400/60 cursor-pointer">{t("aiPage.thinking")}</summary>
                        <div className="mt-1 p-2 bg-black/20 rounded-lg text-xs text-slate-500 whitespace-pre-wrap">
                          {streamReasoning}
                        </div>
                      </details>
                    )}
                    <div className="break-words">{renderContent(streamContent)}</div>
                  </div>
                </div>
              )}
              {streaming && !streamContent && !streamReasoning && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                    <div className="flex gap-0.5">
                      <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                  <div className="rounded-2xl px-4 py-2.5 bg-white/[0.04] text-slate-500 text-sm">
                    {t("aiPage.thinkingDetail")}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
 {/* AI托管审批面板 */}
 {pendingApprovals.length > 0 && (
  <div className="px-4 py-2 border-t border-amber-500/20 bg-amber-950/30">
   <div className="text-xs text-amber-400 font-medium mb-2">{t("aiPage.pendingApprovalsTitle").replace("{count}", String(pendingApprovals.length))}</div>
   <div className="space-y-2">
    {pendingApprovals.map((approval) => (
     <div key={approval.actionId} className="flex items-center justify-between bg-black/30 rounded-lg p-2.5">
      <div className="flex-1 min-w-0">
       <div className="text-sm text-white font-medium">{approval.actionName}</div>
       <div className="text-xs text-[var(--text-secondary)] truncate">
 {t("aiPage.riskLabel")}<span className={
 approval.riskLevel === "critical" ? "text-rose-400" :
 approval.riskLevel === "high" ? "text-orange-400" :
 approval.riskLevel === "medium" ? "text-yellow-400" : "text-green-400"
}>{approval.riskLevel}</span>
{typeof approval.params.serverId === "string" && <span className="ml-2">{t("aiPage.serverLabel").replace("{id}", approval.params.serverId)}</span>}
       </div>
      </div>
      <div className="flex gap-2 ml-3">
       <button
        className="px-3 py-1 text-xs rounded bg-rose-600 hover:bg-rose-700 disabled:bg-rose-900/60 disabled:cursor-not-allowed text-white transition"
        disabled={approvalBusyById[approval.actionId]}
        aria-busy={approvalBusyById[approval.actionId] ? "true" : undefined}
        onClick={() => void handleHostedActionDecision(approval, "reject")}
       >{t("aiPage.reject")}</button>
       <button
        className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-700 disabled:bg-green-900/60 disabled:cursor-not-allowed text-white transition"
        disabled={approvalBusyById[approval.actionId]}
        aria-busy={approvalBusyById[approval.actionId] ? "true" : undefined}
        onClick={() => void handleHostedActionDecision(approval, "confirm")}
       >{t("aiPage.approve")}</button>
      </div>
     </div>
    ))}
   </div>
  </div>
 )}
            </div>

            {/* File/Attachment preview area */}
            {(fileAttachments.length > 0 || (activeConv.enableVision && imageUrls.length > 0)) && (
              <div className="px-4 pb-1.5 border-t border-white/[0.03] bg-slate-950/20">
                <div className="flex flex-wrap gap-2 py-2">
                  {/* URL-based images */}
                  {imageUrls.map((url, i) => (
 <div key={`url-${i}`} className="relative group">
					<Image src={url} alt="" width={48} height={48} loading="lazy" unoptimized className="w-12 h-12 rounded object-cover border border-[var(--border)]" />
                      <button
                        onClick={() => setImageUrls((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                {/* File attachments */}
                {fileAttachments.map((file, i) => (
                  <div key={`file-${i}`} className="relative group">
 {file.type === "image" && file.preview ? (
						<Image src={file.preview} alt={file.name} width={48} height={48} loading="lazy" unoptimized className="w-12 h-12 rounded object-cover border border-[var(--border)]" />
                    ) : (
                      <div className="w-12 h-12 rounded border border-[var(--border)] bg-black/30 flex flex-col items-center justify-center">
                        {file.mimeType.startsWith("video/") ? (
                          <span className="text-base" title={t("aiPage.videoFileTitle")}>🎬</span>
                        ) : file.mimeType.startsWith("audio/") ? (
                          <span className="text-base" title={t("aiPage.audioFileTitle")}>🎵</span>
                        ) : file.mimeType === "application/pdf" || file.mimeType.includes("officedocument") ? (
                          <span className="text-base" title={t("aiPage.documentFileTitle")}>📑</span>
                        ) : (
                          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                        <span className="text-[7px] text-slate-500 truncate max-w-[44px] mt-0.5">{file.name}</span>
                      </div>
                    )}
                      <button
                        onClick={() => setFileAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Image URL input (when vision enabled) */}
            {activeConv.enableVision && (
              <div className="px-4 pb-1">
                <div className="flex gap-2">
                  <input
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    placeholder={t("aiPage.imageUrlPlaceholder")}
                    aria-label={t("aiPage.imageUrlAria")}
                    className="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && imageUrlInput.trim()) {
                        setImageUrls((prev) => [...prev, imageUrlInput.trim()]);
                        setImageUrlInput("");
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* Input area — TR-036 lazy chunk (file upload + textarea + send/stop) */}
            <AiInputAreaLazy
              input={input}
              setInput={setInput}
              streaming={streaming}
              activeConv={activeConv}
              currentModelCaps={currentModelCaps}
              textareaRef={textareaRef}
              fileInputRef={fileInputRef}
              fileAttachmentsState={{
                fileAttachments,
                fileRejectionMsg,
                clearRejection,
                handleFileSelect,
                handlePaste,
                handleDrop,
                handleDragOver,
                setFileAttachments,
                clearAttachments: () => setFileAttachments([]),
              }}
              handleSend={handleSend}
              handleStopGeneration={handleStopGeneration}
            />
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-slate-600">
            <svg className="mb-4 h-16 w-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25" />
            </svg>
            {providers.length === 0 ? (
              <>
                <p className="text-sm font-medium text-slate-300">{t("aiPage.emptyNoProvider")}</p>
                <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                  {t("aiPage.emptyNoProviderHint")}
                </p>
                <button
                  type="button"
                  onClick={() => setShowProviders(true)}
                  className="mt-5 h-9 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/30"
                >
                  {t("aiPage.configProviders")}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm mb-3">{t("aiPage.emptySelectConv")}</p>
                <button
                  type="button"
                  onClick={handleNewConv}
                  className="h-9 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/30"
                >
                  {t("aiPage.newConversation")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Provider Management Panel (overlay) — TR-036 lazy chunk ── */}
      <AiProviderPanelLazy
        show={showProviders}
        providers={providers}
        provForm={provForm}
        onClose={() => setShowProviders(false)}
        onCreateProvider={handleCreateProvider}
        onDeleteProvider={handleDeleteProvider}
        onRefreshProviders={refreshProviders}
        setProvForm={setProvForm}
      />

    </div>
    );
  }
