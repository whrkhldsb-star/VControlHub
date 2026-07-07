"use client";

/**
 * `useAiSendActions` — orchestrates the two "user-facing" actions the
 * AI page exposes on the input area + new-conversation toolbar:
 *   - `handleSend`: build optimistic user message, auto-title first
 *     turn, drain attachment buffers, call the streaming SSE hook.
 *   - `handleNewConv`: pick the default provider and POST a new
 *     conversation; if no providers exist, surface a toast + open the
 *     provider panel via the caller.
 *
 * Extracted from ai-client.tsx in R31.
 */
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import type { FileAttachment, Message, Provider } from "../ai-types";
import type { SendArgs } from "./use-ai-chat-stream";

type ToastFn = (kind: "success" | "error" | "info", message: string) => void;

export function useAiSendActions({
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
  openProviderPanel,
  addToast,
}: {
  activeConvId: string | null;
  streaming: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  imageUrls: string[];
  setImageUrls: Dispatch<SetStateAction<string[]>>;
  fileAttachments: FileAttachment[];
  setFileAttachments: Dispatch<SetStateAction<FileAttachment[]>>;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  autoTitle: (convId: string, firstMsg: string) => Promise<void> | void;
  sendMessage: (args: SendArgs) => Promise<void>;
  providers: Provider[];
  refreshConversations: () => Promise<void> | void;
  setActiveConvId: (id: string | null) => void;
  openProviderPanel: () => void;
  addToast: ToastFn;
}) {
  const { t } = useI18n();

  const handleSend = useCallback(async () => {
    if (!activeConvId || streaming) return;
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
    if (messages.length === 0) autoTitle(activeConvId, userMsg);

    await sendMessage({
      content: userMsg,
      imageUrls: userImages,
      imageBase64: userImageBase64,
      fileAttachments: userFiles,
    });
  }, [
    activeConvId,
    streaming,
    input,
    fileAttachments,
    imageUrls,
    messages.length,
    autoTitle,
    sendMessage,
    setInput,
    setImageUrls,
    setFileAttachments,
    setMessages,
    t,
  ]);

  const handleNewConv = useCallback(async () => {
    const defaultProvider =
      providers.find((p) => p.isDefault && p.enabled) ||
      providers.find((p) => p.enabled);
    if (!defaultProvider) {
      addToast("error", t("aiPage.noProviderToast"));
      openProviderPanel();
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
      // Conversation creation failed — notify the user via toast.
      addToast("error", t("aiPage.createConvFailed"));
    }
  }, [
    providers,
    refreshConversations,
    setActiveConvId,
    openProviderPanel,
    addToast,
    t,
  ]);

  return { handleSend, handleNewConv };
}
