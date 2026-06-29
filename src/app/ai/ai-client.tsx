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
 * This file owns:
 *   - top-level state (providers, sidebar, modal toggles, model list,
 *     settings form, copy feedback)
 *   - composition of the above hooks and components
 *   - per-conversation settings PATCH
 *   - send/auto-title shim that decorates SSE start with optimistic
 *     user message
 *   - markdown export of the active conversation
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import { AiAttachmentsPreview } from "./ai-attachments-preview";
import { AiChatHeader } from "./ai-chat-header";
import { AiConfirmDialog } from "./ai-confirm-dialog";
import { AiEmptyState } from "./ai-empty-state";
import { exportConversationToMarkdown } from "./ai-export";
import { AiInputAreaLazy } from "./ai-input-area-lazy";
import { AiMessageList } from "./ai-message-list";
import { AiProviderPanelLazy } from "./ai-provider-panel-lazy";
import { AiRenameDialog } from "./ai-rename-dialog";
import { AiSettingsPanelLazy } from "./ai-settings-panel-lazy";
import { AiSidebar } from "./ai-sidebar";
import type { ConvItem, ModelInfo, Provider } from "./ai-types";
import { useAiChatStream } from "./hooks/use-ai-chat-stream";
import { useAiConfirmAction } from "./hooks/use-ai-confirm-action";
import { useAiSendActions } from "./hooks/use-ai-send-actions";
import { useConversations } from "./hooks/use-conversations";
import { useConvRename } from "./hooks/use-conv-rename";
import { useConvSettingsForm } from "./hooks/use-conv-settings-form";
import { useFileAttachments } from "./hooks/use-file-attachments";
import { useModelCapabilities } from "./hooks/use-model-capabilities";
import { useProviderForm } from "./hooks/use-provider-form";

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
  const [showProviders, setShowProviders] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
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
  } = useFileAttachments({
    currentModelCaps,
    modelName: activeConv?.model,
    enableVision: activeConv?.enableVision,
    onReject: (msg) => addToast("error", msg),
  });

  const {
    streaming,
    streamContent,
    streamReasoning,
    pendingApprovals,
    approvalBusyById,
    sendMessage,
    stopGeneration,
    decideApproval,
  } = useAiChatStream({
    activeConv,
    activeConvId,
    setMessages,
    refreshConversations,
    addToast,
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent, streamReasoning]);

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

  const refreshProviders = useCallback(async () => {
    const data = await csrfFetch("/api/ai/providers");
    if (data.providers) setProviders(data.providers);
  }, []);

  const { provForm, setProvForm, handleCreateProvider } = useProviderForm({
    refreshProviders,
    addToast,
  });

  const confirm = useAiConfirmAction({
    activeConvId,
    activeConvProviderId: activeConv?.providerId,
    clearActiveConv: () => setActiveConvId(null),
    refreshConversations,
    refreshProviders,
    clearMessages: () => setMessages([]),
  });

  const rename = useConvRename({
    activeConvId,
    refreshConversations,
    addToast,
  });

  /* ── Send + new-conversation ───────────────────────────────── */
  const { handleSend, handleNewConv } = useAiSendActions({
    activeConvId,
    streaming,
    input,
    setInput,
    imageUrls,
    setImageUrls,
    fileAttachments,
    setFileAttachments,
    messages,
    setMessages,
    autoTitle,
    sendMessage,
    providers,
    refreshConversations,
    setActiveConvId,
    openProviderPanel: () => setShowProviders(true),
    addToast,
  });

  /* ── Per-conversation settings PATCH ───────────────────────── */
  const { settingsForm, setSettingsForm, handleSaveSettings } =
    useConvSettingsForm({
      activeConv,
      activeConvId,
      refreshConversations,
      onSaved: () => setShowSettings(false),
      addToast,
    });

  /* ── Export conversation to markdown ───────────────────────── */
  const handleExportConversation = () =>
    activeConvId &&
    void exportConversationToMarkdown({
      conversationId: activeConvId,
      providerName: activeProvider?.name ?? "",
      t,
    });

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {confirm.copy && (
        <AiConfirmDialog
          open
          title={confirm.copy.title}
          description={confirm.copy.description}
          confirmLabel={confirm.copy.confirmLabel}
          error={confirm.error}
          busy={confirm.busy}
          onCancel={confirm.close}
          onConfirm={confirm.run}
        />
      )}
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
        onNewConv={handleNewConv}
        onSelectConv={setActiveConvId}
        onDeleteConv={(id) => {
          const target = conversations.find((conv) => conv.id === id);
          confirm.open({
            type: "delete-conversation",
            id,
            title: target?.title ?? t("aiPage.fallbackConvName"),
          });
        }}
        onToggleSidebar={setShowSidebar}
        onToggleProviders={() => setShowProviders(!showProviders)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {activeConv ? (
          <>
            <AiChatHeader
              activeConv={activeConv}
              activeProvider={activeProvider ?? null}
              currentModelCaps={currentModelCaps}
              onToggleSidebar={() => setShowSidebar(true)}
              onToggleSettings={() => setShowSettings(!showSettings)}
              onClearMessages={() => confirm.open({ type: "clear-messages" })}
              onRenameConv={() => rename.openWith(activeConv.title)}
              onExportConv={handleExportConversation}
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
            />
            <AiMessageList
              messages={messages}
              streaming={streaming}
              streamContent={streamContent}
              streamReasoning={streamReasoning}
              pendingApprovals={pendingApprovals}
              approvalBusyById={approvalBusyById}
              onApproval={decideApproval}
              copyFeedback={copyFeedback}
              setCopyFeedback={setCopyFeedback}
              currentModelCaps={currentModelCaps}
              messagesEndRef={messagesEndRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
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
            />
          </>
        ) : (
          <AiEmptyState
            hasProviders={providers.length > 0}
            onOpenProviders={() => setShowProviders(true)}
            onNewConv={handleNewConv}
          />
        )}
      </div>

      <AiProviderPanelLazy
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
      />
    </div>
  );
}
