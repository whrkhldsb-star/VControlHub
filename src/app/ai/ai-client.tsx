"use client";

/**
 * AiClient — orchestration shell for the AI chat page.
 *
 * R31 split. Streaming/approval flow moved to hooks/use-ai-chat-stream.
 * Confirm-flow moved to hooks/use-ai-confirm-action. Rename modal moved
 * to hooks/use-conv-rename. Create-provider form moved to
 * hooks/use-provider-form. Transcript + attachments + rename + empty
 * state moved to sibling components.
 *
 * R19 adds the working mode (Plan / Confirm / Auto / Full auto, with the
 * Full auto confirmation and countdown: hooks/use-automation-mode), pinned
 * servers (hooks/use-pinned-servers, `?server=<id>` deep links), the live
 * follow-up of inline-confirmed and automatically run commands
 * (hooks/use-hosted-action-tracker) and the continuation of the answer once
 * they settle (hooks/use-ai-continuation).
 *
 * This file owns:
 *   - top-level state (providers, sidebar, modal toggles, model list,
 *     settings form, copy feedback)
 *   - composition of the above hooks and components
 *   - per-conversation settings PATCH
 *   - send/auto-title shim that decorates SSE start with optimistic
 *     user message
 *   - markdown export of the active conversation
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";

import { AiAttachmentsPreview } from "./ai-attachments-preview";
import { type AiCapabilities, DEFAULT_AI_CAPABILITIES } from "./ai-automation-mode";
import { AiChatHeader } from "./ai-chat-header";
import { AiEmptyState } from "./ai-empty-state";
import { exportConversationToMarkdown } from "./ai-export";
import { AiFullAutoDialog } from "./ai-full-auto-dialog";
import { AiInputAreaLazy } from "./ai-input-area-lazy";
import {
  mergePendingApprovals,
  pendingApprovalsFromMessages,
  settledActionIds,
} from "./ai-hosted-action-utils";
import { AiMessageList } from "./ai-message-list";
import { AiModeSwitcher } from "./ai-mode-switcher";
import { AiPinnedServers } from "./ai-pinned-servers";
import { AiProviderPanelLazy } from "./ai-provider-panel-lazy";
import { AiRenameDialog } from "./ai-rename-dialog";
import { AiSettingsPanelLazy } from "./ai-settings-panel-lazy";
import { AiSidebar } from "./ai-sidebar";
import type { AiServerOption, ConvItem, ModelInfo, Provider, ToolApprovalNeeded } from "./ai-types";
import { type ApprovalDecisionOptions, type ToolExecutionEvent, useAiChatStream } from "./hooks/use-ai-chat-stream";
import { useAiConfirmAction } from "./hooks/use-ai-confirm-action";
import { useAiContinuation } from "./hooks/use-ai-continuation";
import { useAiSendActions } from "./hooks/use-ai-send-actions";
import { useAutomationMode } from "./hooks/use-automation-mode";
import { useConversations } from "./hooks/use-conversations";
import { type TrackedAction, useHostedActionTracker } from "./hooks/use-hosted-action-tracker";
import { usePinnedServers } from "./hooks/use-pinned-servers";
import { recoverChatDraft } from "./ai-retry";
import { useConvRename } from "./hooks/use-conv-rename";
import { useConvSettingsForm } from "./hooks/use-conv-settings-form";
import { useFileAttachments } from "./hooks/use-file-attachments";
import { attachmentCapabilities } from "./ai-file-helpers";
import { useModelCapabilities } from "./hooks/use-model-capabilities";
import { useProviderForm } from "./hooks/use-provider-form";
import { getErrorMessage } from "@/lib/http/error-message";
import { replaceBrowserUrl } from "@/lib/browser-history";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

const NO_SERVERS: AiServerOption[] = [];

export function AiClient({
  initialProviders,
  initialConversations,
  initialDraft = "",
  canManageProviders = false,
  capabilities = DEFAULT_AI_CAPABILITIES,
  servers = NO_SERVERS,
  initialPinnedServerId = null,
  pinnedServerRejected = false,
}: {
  /** Kept optional for older tests/call-sites; auth is session/API-backed. */
  userId?: string;
  initialProviders: Provider[];
  initialConversations: ConvItem[];
  /** Prefilled composer text (e.g. ?q= "Ask AI" deep links from ops pages). */
  initialDraft?: string;
  canManageProviders?: boolean;
  /** What this account may do with the assistant (modes, execution, review), resolved on the server. */
  capabilities?: AiCapabilities;
  /** Servers the pinned-server picker offers (`server:read` only). */
  servers?: AiServerOption[];
  /** `/ai?server=<id>`: a new conversation starts pinned to this server. */
  initialPinnedServerId?: string | null;
  /** `?server=` named a server this account cannot reach: say it was not pinned. */
  pinnedServerRejected?: boolean;
}) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const panelParam = searchParams?.get("panel") ?? null;
  const convParam = searchParams?.get("c") ?? null;
  const highlightActionId = searchParams?.get("action") ?? null;
  const initialActiveConvId =
    convParam && initialConversations.some((c) => c.id === convParam) ? convParam : null;
  const [providers, setProviders] = useState(initialProviders);
  const {
    conversations,
    activeConvId,
    setActiveConvId,
    activeConv,
    messages,
    setMessages,
    messagesError,
    retryMessages,
    refreshConversations,
    upsertConversation,
  } = useConversations({ initialConversations, initialActiveConvId });
  const [input, setInput] = useState(initialDraft);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [showProviders, setShowProviders] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Track the ?c= value written by this component so Next adopting replaceBrowserUrl
  // cannot echo a previous conversation id back into the deep-link effect on rapid A->B switches.
  const lastWrittenConvIdRef = useRef<string | null>(initialActiveConvId);

  // Support /ai?panel=providers and /ai?c=<id> deep links (including client-side router.push
  // from global search while /ai is already open), and keep active conversation in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (panelParam === "providers" && canManageProviders) {
      setShowProviders(true);
      const params = new URLSearchParams(window.location.search);
      params.delete("panel");
      const nextQuery = params.toString();
      replaceBrowserUrl(
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`,
      );
    }
    if (
      convParam &&
      convParam !== lastWrittenConvIdRef.current &&
      conversationsRef.current.some((c) => c.id === convParam)
    ) {
      lastWrittenConvIdRef.current = convParam;
      setActiveConvId(convParam);
    }
  }, [panelParam, convParam, canManageProviders, setActiveConvId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastWrittenConvIdRef.current = activeConvId;
    const params = new URLSearchParams(window.location.search);
    if (activeConvId) params.set("c", activeConvId);
    else params.delete("c");
    const nextQuery = params.toString();
    const target = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    if (target !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      replaceBrowserUrl(target);
    }
  }, [activeConvId]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeProvider = activeConv
    ? providers.find((p) => p.id === activeConv.providerId)
    : null;

  const {
    caps: currentModelCaps,
    supportsVision: currentModelSupportsVision,
  } = useModelCapabilities(activeConv?.model, modelList);

  const {
    fileAttachments,
    setFileAttachments,
    fileRejectionMsg,
    clearRejection,
    handleFileSelect,
    handlePaste,
    handleDrop,
    handleDragOver,
    clearAttachments,
  } = useFileAttachments({
    currentModelCaps,
    modelName: activeConv?.model,
    enableVision: activeConv?.enableVision,
    providerType: activeConv?.provider?.type,
    onReject: (msg) => addToast("error", msg),
    t,
  });

  /* ── Live follow-up of the actions that run (inline confirmations, Auto / Full auto steps) ── */
  // The tracker reports a settled action; the transcript is then read again, except while a stream is open
  // (it reads the transcript itself when it ends, and a read during it would double the answer on screen).
  const streamingRef = useRef(false);
  const refreshAfterSettleRef = useRef<() => void>(() => undefined);
  const onActionSettled = useCallback((_action: TrackedAction) => {
    if (!streamingRef.current) refreshAfterSettleRef.current();
  }, []);
  const tracker = useHostedActionTracker({
    activeConvId,
    messages,
    addToast,
    onSettled: onActionSettled,
  });
  const { track } = tracker;
  const onToolExecution = useCallback((event: ToolExecutionEvent) => {
    track({
      actionId: event.actionId,
      conversationId: event.conversationId,
      mode: event.phase === "awaiting_review" ? "review" : "run",
      commandRequestId: event.commandRequestId,
      // The server stopped waiting for this command but it still runs: the page continues the answer when it ends.
      autoContinue: event.phase === "timeout",
    });
  }, [track]);

  const {
    streaming,
    streamContent,
    streamReasoning,
    streamSteps,
    pendingApprovals: streamedPendingApprovals,
    approvalBusyById,
    decidedActionIds,
    sendMessage,
    continueConversation,
    retryFailedMessage,
    stopGeneration,
    lastRequest,
    clearConversationStream,
    decideApproval,
    refreshActiveMessages,
  } = useAiChatStream({
    activeConv,
    activeConvId,
    setMessages,
    refreshConversations,
    addToast,
    onToolExecution,
  });
  useEffect(() => {
    streamingRef.current = streaming;
    refreshAfterSettleRef.current = () => {
      void refreshActiveMessages().catch(() => addToast("error", t("aiPage.historyLoadFailed")));
    };
  }, [streaming, refreshActiveMessages, addToast, t]);

  const pendingApprovals = useMemo(() => {
    const settled = settledActionIds(messages);
    return mergePendingApprovals(
      // A card that arrived in the stream is dropped once the transcript shows its action settled.
      streamedPendingApprovals.filter((approval) => !settled.has(approval.actionId)),
      pendingApprovalsFromMessages(messages),
      // A decision the server accepted: its card goes at once, not when the transcript is read again.
    ).filter((approval) => !decidedActionIds.has(approval.actionId));
  }, [messages, streamedPendingApprovals, decidedActionIds]);

  /** Confirm / reject a card, then follow what it led to: a run (live output, then the answer continues) or a review. */
  const handleApproval = useCallback(
    async (approval: ToolApprovalNeeded, action: "confirm" | "reject", options?: ApprovalDecisionOptions) => {
      const outcome = await decideApproval(approval, action, options);
      if (!outcome || !outcome.conversationId) return;
      if (outcome.kind === "executing") {
        track({ actionId: outcome.actionId, conversationId: outcome.conversationId, mode: "run", commandRequestId: outcome.commandRequestId, autoContinue: true });
      } else if (outcome.kind === "review") {
        track({ actionId: outcome.actionId, conversationId: outcome.conversationId, mode: "review", commandRequestId: outcome.commandRequestId });
      }
    },
    [decideApproval, track],
  );

  // FE/c3: composer draft is per-workspace UI state — reset when switching
  // conversations so text/attachments never leak into another chat.
  // A pending prefill (example chip / ?q= deep link) is applied AFTER the
  // clears so conversation creation can't wipe it.
  const pendingDraftRef = useRef<string | null>(initialDraft || null);
  const prevConvIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevConvIdRef.current === undefined) {
      prevConvIdRef.current = activeConvId;
      return;
    }
    if (prevConvIdRef.current === activeConvId) return;
    prevConvIdRef.current = activeConvId;
    setInput("");
    setImageUrls([]);
    setImageUrlInput("");
    // Also drops reads still running for the conversation left behind.
    clearAttachments();
    if (pendingDraftRef.current) {
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      setInput(draft);
    }
  }, [activeConvId, clearAttachments]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent, streamReasoning, streamSteps]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowSidebar(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  // Fetch models when provider changes
  const modelsFetchGenRef = useRef(0);
  const fetchModels = useCallback(async (providerId: string) => {
    const gen = ++modelsFetchGenRef.current;
    setModelsLoading(true);
    try {
      const data = await csrfFetch(`/api/ai/models?providerId=${providerId}`);
      if (gen !== modelsFetchGenRef.current) return;
      if (data.models) setModelList(data.models);
    } catch {
      if (gen !== modelsFetchGenRef.current) return;
      // Failed to fetch models — show an empty list so the UI remains usable.
      setModelList([]);
    } finally {
      if (gen === modelsFetchGenRef.current) setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeConv?.providerId) {
      void fetchModels(activeConv.providerId);
    } else {
      modelsFetchGenRef.current += 1;
      setModelList([]);
      setModelsLoading(false);
    }
  }, [activeConv?.providerId, fetchModels]);

  const refreshProviders = useCallback(async () => {
    const data = await csrfFetch("/api/ai/providers");
    if (data.providers) setProviders(data.providers);
  }, []);

  const { provForm, setProvForm, handleCreateProvider, creating: creatingProvider } = useProviderForm({
    refreshProviders,
    addToast,
  });

  const confirm = useAiConfirmAction({
    activeConvId,
    activeConvProviderId: activeConv?.providerId,
    clearActiveConv: () => setActiveConvId(null),
    refreshConversations,
    refreshProviders,
    clearMessages: () => {
      clearConversationStream();
      setMessages([]);
    },
  });

  const rename = useConvRename({
    activeConvId,
    refreshConversations,
    addToast,
  });

  /* ── Working mode and pinned servers ───────────────────────── */
  const automation = useAutomationMode({
    activeConv,
    caps: capabilities,
    onConversationUpdated: upsertConversation,
    addToast,
  });
  const pins = usePinnedServers({
    activeConv,
    onConversationUpdated: upsertConversation,
    addToast,
  });

  /* ── Send + new-conversation ───────────────────────────────── */
  const { handleSend: sendDraft, handleNewConv } = useAiSendActions({
    activeConvId,
    streaming,
    input,
    setInput,
    imageUrls,
    setImageUrls,
    fileAttachments,
    setFileAttachments,
    setMessages,
    sendMessage,
    providers,
    refreshConversations,
    setActiveConvId,
    openProviderPanel: () => setShowProviders(canManageProviders),
    addToast,
  });

  const composerDirty = Boolean(input.trim() || imageUrls.length > 0 || fileAttachments.length > 0);
  const continuation = useAiContinuation({
    activeConvId,
    messages,
    tracked: tracker.tracked,
    streaming,
    composerDirty,
    continueConversation,
  });
  const { resetAutoBudget } = continuation;
  // A message from the user is a fresh start for auto-continue's budget.
  const handleSend = useCallback(() => {
    resetAutoBudget();
    void sendDraft();
  }, [resetAutoBudget, sendDraft]);

  /** Re-send the latest user turn (regenerate / retry after an error bubble).
   *  The server appends a fresh assistant reply; history stays intact. */
  const handleRegenerate = useCallback(() => {
    if (!activeConvId || streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const saved = lastRequest.current;
    if (saved?.conversationId === activeConvId && saved.messageId === lastUser.id) {
      void sendMessage(saved.args);
      return;
    }
    const recovered = recoverChatDraft(lastUser);
    if (recovered.needsFiles) {
      setInput(recovered.args.content);
      setImageUrls(recovered.args.imageUrls);
      setFileAttachments(recovered.args.fileAttachments.map((file) => ({ ...file, type: "text", mimeType: "text/plain" })));
      addToast("info", t("aiPage.reselectLocalAttachments"));
      fileInputRef.current?.click();
      return;
    }
    void sendMessage(recovered.args);
  }, [activeConvId, streaming, messages, sendMessage, lastRequest, setFileAttachments, addToast, t]);

  /** One-step model switch from the chat header pill (PATCH + refresh). */
  const handleQuickSwitchModel = useCallback(
    async (model: string) => {
      if (!activeConvId || !model || model === activeConv?.model) return;
      try {
        await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
        await refreshConversations();
        addToast("success", t("aiPage.modelSwitched", { model }));
      } catch (error) {
        addToast("error", getErrorMessage(error, t("aiPage.saveFailed")));
      }
    },
    [activeConvId, activeConv?.model, refreshConversations, addToast, t],
  );

  // A ?q= deep link with no open conversation: create one so the draft has
  // somewhere to land (the conv-switch effect applies it after the clears).
  const draftKickRef = useRef(Boolean(initialDraft));
  // A ?server=<id> deep link (the servers page's "Ask AI"): a new conversation pinned to that server. A ?c=
  // link to an existing conversation wins over it.
  const serverKickRef = useRef(initialActiveConvId ? null : initialPinnedServerId);
  useEffect(() => {
    if (!serverKickRef.current || providers.length === 0) return;
    const serverId = serverKickRef.current;
    serverKickRef.current = null;
    // This conversation also takes the ?q= draft.
    draftKickRef.current = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.delete("server");
      const nextQuery = params.toString();
      replaceBrowserUrl(`${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    }
    void handleNewConv({ pinnedServerIds: [serverId] });
  }, [providers.length, handleNewConv]);
  useEffect(() => {
    if (!draftKickRef.current || activeConvId || providers.length === 0) return;
    draftKickRef.current = false;
    void handleNewConv();
  }, [activeConvId, providers.length, handleNewConv]);
  const rejectionShownRef = useRef(false);
  useEffect(() => {
    if (!pinnedServerRejected || rejectionShownRef.current) return;
    rejectionShownRef.current = true;
    addToast("info", t("aiPage.pins.linkedUnavailable"));
  }, [pinnedServerRejected, addToast, t]);

  /* ── Per-conversation settings PATCH ───────────────────────── */
  const {
    settingsForm,
    setSettingsForm,
    handleSaveSettings,
    resetForm,
    dirty: settingsDirty,
  } = useConvSettingsForm({
    activeConv,
    activeConvId,
    refreshConversations,
    onSaved: () => setShowSettings(false),
    addToast,
  });
  const {
    requestAction: requestSettingsAction,
    requestDiscard: requestCloseSettings,
    discardDialog: settingsDiscardDialog,
  } = useUnsavedChangesGuard({
    dirty: (showSettings && settingsDirty) || composerDirty,
    onDiscard: () => { resetForm(); setShowSettings(false); },
  });

  /* ── Export conversation to markdown ───────────────────────── */
  const handleExportConversation = () => {
    if (!activeConvId) return;
    void exportConversationToMarkdown({
      conversationId: activeConvId,
      providerName: activeProvider?.name ?? "",
      t,
    }).catch((err) => {
      addToast(
        "error",
        getErrorMessage(err, t("aiPage.exportFailed")),
      );
    });
  };

  const canPin = capabilities.canReadServers && servers.length > 0;
  const composerToolbar = activeConv ? (
    <>
      {canPin || pins.pinnedIds.length > 0 ? (
        <AiPinnedServers
          servers={servers}
          pinnedIds={pins.pinnedIds}
          canEdit={canPin}
          saving={pins.saving}
          onChange={(ids) => void pins.setPinned(ids)}
        />
      ) : null}
      <AiModeSwitcher
        capabilities={capabilities}
        requested={automation.requested}
        effective={automation.effective}
        hostingEnabled={automation.hostingEnabled}
        busy={automation.busy}
        onRequestMode={automation.requestMode}
      />
    </>
  ) : null;

  return (
    <div
      data-ai-workspace
      className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] min-h-80 overflow-hidden bg-[var(--page-bg)] pt-16 lg:h-[calc(100dvh-var(--topbar-height))] lg:pt-0"
    >
      {confirm.copy && (
        <ConfirmDialog
          open
          title={confirm.copy.title}
          description={confirm.copy.description}
          cancelLabel={t("aiPage.cancel")}
          confirmLabel={confirm.busy ? t("aiPage.processing") : confirm.copy.confirmLabel}
          error={confirm.error}
          busy={confirm.busy}
          onCancel={confirm.close}
          onConfirm={confirm.run}
        />
      )}
      {automation.fullAutoDialogOpen && activeConv ? (
        <AiFullAutoDialog
          open
          busy={automation.busy}
          maxTtlMinutes={capabilities.maxFullAutoTtlMinutes}
          defaultTtlMinutes={automation.defaultTtlMinutes}
          allowCritical={capabilities.fullAutoAllowCritical}
          pinnedServerCount={pins.pinnedIds.length}
          onCancel={automation.closeFullAutoDialog}
          onConfirm={(ttl) => void automation.confirmFullAuto(ttl)}
        />
      ) : null}
      <AiRenameDialog
        open={rename.open}
        title={rename.title}
        busy={rename.busy}
        error={rename.error}
        onChangeTitle={rename.setTitle}
        onCancel={rename.close}
        onConfirm={rename.submit}
      />
      <AiSidebar
        showSidebar={showSidebar}
        conversations={conversations}
        activeConvId={activeConvId}
        namesPage={!activeConv}
        onNewConv={() =>
          requestSettingsAction(() => {
            setShowSettings(false);
            void handleNewConv();
          })
        }
        onSelectConv={(id) => {
          if (id === activeConvId) {
            if (!window.matchMedia("(min-width: 768px)").matches) setShowSidebar(false);
            return;
          }
          requestSettingsAction(() => {
            setShowSettings(false);
            setActiveConvId(id);
            // On phones the sidebar overlays the conversation; selecting a
            // conversation must dismiss it or the composer stays hidden.
            if (!window.matchMedia("(min-width: 768px)").matches) setShowSidebar(false);
          });
        }}
        onDeleteConv={(id) => {
          const openDeleteConfirm = () => {
            setShowSettings(false);
            const target = conversations.find((conv) => conv.id === id);
            confirm.open({
              type: "delete-conversation",
              id,
              title: target?.title ?? t("aiPage.fallbackConvName"),
            });
          };
          if ((showSettings && settingsDirty) || (composerDirty && id === activeConvId)) {
            requestSettingsAction(openDeleteConfirm);
          } else {
            openDeleteConfirm();
          }
        }}
        onToggleSidebar={setShowSidebar}
        onToggleProviders={canManageProviders ? () => setShowProviders(!showProviders) : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {activeConv ? (
          <>
            <AiChatHeader
              activeConv={activeConv}
              activeProvider={activeProvider ?? null}
              currentModelCaps={currentModelCaps}
              modelList={modelList}
              onQuickSwitchModel={(model) => void handleQuickSwitchModel(model)}
              sidebarShown={showSidebar}
              onToggleSidebar={() => setShowSidebar(true)}
              onToggleSettings={() => {
                if (showSettings) {
                  if (settingsDirty) requestCloseSettings();
                  else setShowSettings(false);
                } else {
                  setShowSettings(true);
                }
              }}
              onClearMessages={() => confirm.open({ type: "clear-messages" })}
              onRenameConv={() => rename.openWith(activeConv.title)}
              onExportConv={handleExportConversation}
              automation={automation}
            />
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
              onRefreshModels={() =>
                activeConv?.providerId && fetchModels(activeConv.providerId)
              }
              capabilities={capabilities}
              onRequestMode={automation.requestMode}
              modeBusy={automation.busy}
            />
            <AiMessageList
              messages={messages}
              streaming={streaming}
              streamContent={streamContent}
              streamReasoning={streamReasoning}
              streamSteps={streamSteps}
              pendingApprovals={pendingApprovals}
              approvalBusyById={approvalBusyById}
              onApproval={(approval, action, options) => void handleApproval(approval, action, options)}
              currentModelCaps={attachmentCapabilities(currentModelCaps, activeConv.provider?.type, activeConv.enableVision)}
              messagesEndRef={messagesEndRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onRegenerate={handleRegenerate}
              onRetry={retryFailedMessage}
              loadError={messagesError ? getErrorMessage(messagesError, t("aiPage.historyLoadFailed")) : null}
              onRetryLoad={retryMessages}
              capabilities={capabilities}
              trackedActions={tracker.tracked}
              onCancelAction={(actionId) => void tracker.cancel(actionId)}
              continuation={continuation}
              highlightActionId={highlightActionId}
            />
            <AiAttachmentsPreview
              enableVision={activeConv.enableVision}
              imageUrls={imageUrls}
              setImageUrls={setImageUrls}
              imageUrlInput={imageUrlInput}
              setImageUrlInput={setImageUrlInput}
              fileAttachments={fileAttachments}
              setFileAttachments={setFileAttachments}
            />
            <AiInputAreaLazy
              input={input}
              setInput={setInput}
              imageUrls={imageUrls}
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
              handleStopGeneration={stopGeneration}
              toolbar={composerToolbar}
              onCycleMode={automation.cycleMode}
            />
          </>
        ) : (
          <AiEmptyState
            hasProviders={providers.length > 0}
            sidebarShown={showSidebar}
            onOpenProviders={canManageProviders ? () => setShowProviders(true) : undefined}
            onNewConv={() => void handleNewConv()}
            onOpenSidebar={() => setShowSidebar(true)}
            onExample={(prompt) => {
              // Start a conversation (when none is open) and drop the prompt
              // into the composer. The pendingDraft channel matters: the
              // conv-switch effect clears the draft, so the prefill must be
              // applied after the new conversation settles.
              pendingDraftRef.current = prompt;
              if (activeConvId) {
                setInput(prompt);
                pendingDraftRef.current = null;
                textareaRef.current?.focus();
              } else {
                void handleNewConv();
              }
            }}
          />
        )}
      </div>

      {canManageProviders && <AiProviderPanelLazy
        show={showProviders}
        providers={providers}
        provForm={provForm}
        onClose={() => setShowProviders(false)}
        onCreateProvider={handleCreateProvider}
        onDeleteProvider={(id) => {
          const target = providers.find((p) => p.id === id);
          confirm.open({
            type: "delete-provider",
            id,
            name: target?.name ?? t("aiPage.fallbackProviderName"),
          });
        }}
        onRefreshProviders={refreshProviders}
        setProvForm={setProvForm}
        creatingProvider={creatingProvider}
      />}
      {settingsDiscardDialog}
    </div>
  );
}
