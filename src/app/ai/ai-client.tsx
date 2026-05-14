/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Provider, ConvItem, Message, ModelInfo, ModelCapabilities, FileAttachment, ToolCallEvent, ToolApprovalNeeded } from "./ai-types";
import { PROVIDER_TYPES, COMMON_BASE_URLS, DEFAULT_PROV_FORM, DEFAULT_SETTINGS_FORM } from "./ai-types";
import { detectCapabilities, readFileAsText, readFileAsDataURL, categorizeFile, formatAllowedTypes, buildAcceptString } from "./ai-file-helpers";
import { renderContent, copyToClipboard } from "./ai-markdown-renderer";
import { AiSidebar } from "./ai-sidebar";
import { AiChatHeader } from "./ai-chat-header";
import { AiSettingsPanel } from "./ai-settings-panel";
import { AiProviderPanel } from "./ai-provider-panel";
import { useToast } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";

/* ── Main Component ─────────────────────────────────────────── */
export function AiClient({
	initialProviders,
	initialConversations,
}: {
	userId: string;
	initialProviders: Provider[];
	initialConversations: ConvItem[];
}) {
 const { addToast } = useToast();
 const [providers, setProviders] = useState(initialProviders);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
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
 const [fileRejectionMsg, setFileRejectionMsg] = useState<string | null>(null);
 const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
 const messagesEndRef = useRef<HTMLDivElement | null>(null);
 const fileInputRef = useRef<HTMLInputElement | null>(null);
 const textareaRef = useRef<HTMLTextAreaElement | null>(null);
 const abortControllerRef = useRef<AbortController | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const activeProvider = activeConv
    ? providers.find((p) => p.id === activeConv.providerId)
    : null;

  // Resolve current model capabilities (from API list first, fallback to client detection)
  const currentModelCaps: ModelCapabilities = (() => {
    const modelId = activeConv?.model;
    if (!modelId) return { vision: false, document: false, video: false, audio: false };
    // Prefer server-reported capabilities
    const serverModel = modelList.find((m) => m.id === modelId);
    if (serverModel?.capabilities) return serverModel.capabilities;
    // Fallback to client-side detection
    return detectCapabilities(modelId);
  })();

  const currentModelSupportsVision = !!(currentModelCaps.vision || (activeConv?.model && /gpt-4o|claude-3|gemini|qwen-vl/i.test(activeConv.model)));

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent, streamReasoning]);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
	csrfFetch(`/api/ai/conversations/${activeConvId}`)
			.then((data) => {
				if (data.conversation?.messages) setMessages(data.conversation.messages);
			})
			.catch(() => {});
	}, [activeConvId]);

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

  // Refresh conversation list
	const refreshConversations = useCallback(async () => {
		const data = await csrfFetch("/api/ai/conversations");
		if (data.conversations) setConversations(data.conversations);
	}, []);

	const refreshProviders = useCallback(async () => {
		const data = await csrfFetch("/api/ai/providers");
		if (data.providers) setProviders(data.providers);
	}, []);

  /* ── File Handling (capability-aware) ─────────────────────── */
  const showRejection = useCallback((msg: string) => {
    setFileRejectionMsg(msg);
    setTimeout(() => setFileRejectionMsg(null), 4000);
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      // Size limit: 20MB
      if (file.size > 20 * 1024 * 1024) {
        showRejection(`📄 ${file.name} 超过 20MB 限制`);
        continue;
      }

      const category = categorizeFile(file);

      // Check model capabilities vs file category
      switch (category) {
        case "image": {
          if (!currentModelCaps.vision && !activeConv?.enableVision) {
            showRejection(`🖼 当前模型 ${activeConv?.model} 不支持图片输入。请在设置中切换为多模态模型（如 GPT-4o、Claude 3.5 等）`);
            continue;
          }
          const dataUrl = await readFileAsDataURL(file);
          const base64Data = dataUrl.split(",")[1];
          setFileAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              content: "",
              type: "image",
              mimeType: file.type || "image/png",
              base64Data,
              preview: dataUrl,
            },
          ]);
          break;
        }
        case "video": {
          if (!currentModelCaps.video) {
            showRejection(`🎬 当前模型 ${activeConv?.model} 不支持视频输入。支持视频的模型：Gemini 1.5/2、Qwen2-VL、GPT-4o 等`);
            continue;
          }
          // Video: read as base64 for models that support it
          const dataUrl = await readFileAsDataURL(file);
          const base64Data = dataUrl.split(",")[1];
          setFileAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              content: "",
              type: "image", // sent as image_url with video mime type
              mimeType: file.type || "video/mp4",
              base64Data,
              preview: undefined, // no image preview for video
            },
          ]);
          break;
        }
        case "audio": {
          if (!currentModelCaps.audio) {
            showRejection(`🎵 当前模型 ${activeConv?.model} 不支持音频输入。支持音频的模型：Gemini 2、GPT-4o-audio 等`);
            continue;
          }
          const dataUrl = await readFileAsDataURL(file);
          const base64Data = dataUrl.split(",")[1];
          setFileAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              content: "",
              type: "image", // sent as image_url with audio mime type
              mimeType: file.type || "audio/mp3",
              base64Data,
              preview: undefined,
            },
          ]);
          break;
        }
        case "document": {
          if (!currentModelCaps.document) {
            // Fallback: try to read as text for some doc types, or reject
            if (file.name.toLowerCase().endsWith(".pdf")) {
              showRejection(`📑 当前模型 ${activeConv?.model} 不支持 PDF 文件。支持文档的模型：Gemini 1.5/2、Claude 3.5 Sonnet、GPT-4o 等`);
              continue;
            }
            // .docx/.xlsx etc — not text-readable, reject
            showRejection(`📑 当前模型 ${activeConv?.model} 不支持 Office 文档。支持文档的模型：Gemini 1.5/2、Claude 3.5 Sonnet、GPT-4o 等`);
            continue;
          }
          // Document: send as base64
          const dataUrl = await readFileAsDataURL(file);
          const base64Data = dataUrl.split(",")[1];
          setFileAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              content: "",
              type: "image", // sent as image_url with doc mime type
              mimeType: file.type || "application/pdf",
              base64Data,
              preview: undefined,
            },
          ]);
          break;
        }
        case "text": {
          // Text files are always OK (they get injected into the message text)
          const text = await readFileAsText(file);
          const truncated = text.length > 100000 ? text.slice(0, 100000) + "\n...(文件过长，已截断)" : text;
          setFileAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              content: truncated,
              type: "text",
              mimeType: file.type || "text/plain",
            },
          ]);
          break;
        }
        default: {
          showRejection(`❌ 不支持的文件类型: ${file.name}。当前模型可接受：${formatAllowedTypes(currentModelCaps)}`);
        }
      }
	}
	}, [currentModelCaps, activeConv?.enableVision, activeConv?.model, showRejection]);

	// Paste handler — only images for now (browsers don't paste other types)
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        if (!currentModelCaps.vision && !activeConv?.enableVision) {
          showRejection(`🖼 当前模型不支持图片输入，请在设置中切换为多模态模型`);
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleFileSelect([file]);
      }
    }
  }, [currentModelCaps, activeConv?.enableVision, showRejection, handleFileSelect]);

  // Drag & drop handler
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      await handleFileSelect(e.dataTransfer.files);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

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
    const userMsg = input.trim() || "(附件)";
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
 const err = await response.json().catch(() => ({ error: "请求失败" }));
 setStreamContent(`❌ ${err.error || "请求失败"}`);
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
                content: finalContent || "(无响应)",
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
   setStreamContent((prev) => prev + `\n\n⚡ 执行: ${tc.actionName}...`);
  } else {
   setStreamContent((prev) => prev + `\n\n🔒 需要审批: ${tc.actionName}`);
  }
 } else if (parsed.type === "tool_result") {
  // 工具执行结果
  const success = parsed.success as boolean;
  const toolCallId = parsed.toolCallId as string;
  if (success) {
   setStreamContent((prev) => prev + `\n✅ 操作执行成功`);
  } else {
   setStreamContent((prev) => prev + `\n❌ 操作执行失败: ${JSON.stringify(parsed.data).slice(0, 200)}`);
  }
 } else if (parsed.type === "tool_approval_needed") {
  // 需要审批的操作
  const approval = parsed as ToolApprovalNeeded;
  setPendingApprovals((prev) => [...prev, approval]);
  setStreamContent((prev) => prev + `\n⏳ 等待审批: ${approval.actionName} (风险: ${approval.riskLevel})`);
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
      setStreamContent("❌ 网络错误");
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
      addToast("error", "请先添加一个 AI 提供商");
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
      addToast("error", "创建对话失败");
    }
  };

  /* ── Auto-title: generate from first message ──────────────── */
  const autoTitle = useCallback(async (convId: string, firstMsg: string) => {
    const title = firstMsg.slice(0, 30).replace(/\n/g, " ").trim();
    if (!title || title === "(附件)") return;
    try {
      await csrfFetch(`/api/ai/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title + (firstMsg.length > 30 ? "..." : "") }),
      });
      refreshConversations();
    } catch { /* ignore */ }
  }, [refreshConversations]);

  /* ── Delete Conversation ──────────────────────────────────── */
  const handleDeleteConv = async (id: string) => {
    if (!confirm("确定删除此对话？")) return;
    await csrfFetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    if (activeConvId === id) setActiveConvId(null);
    refreshConversations();
  };

  /* ── Provider Form State ────────────────────────────────────── */
  const [provForm, setProvForm] = useState(DEFAULT_PROV_FORM);

  const handleCreateProvider = async () => {
    if (!provForm.name.trim() || !provForm.apiKey.trim()) {
      addToast("error", "名称和 API Key 不能为空");
      return;
    }
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
      addToast("error", "添加失败");
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm("确定删除此提供商？关联的对话也会被删除。")) return;
    await csrfFetch(`/api/ai/providers/${id}`, { method: "DELETE" });
    if (activeConv?.providerId === id) setActiveConvId(null);
    refreshProviders();
    refreshConversations();
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
      addToast("error", "保存失败");
    }
  };

 // Auto-detect vision from selected model
 const selectedModelInfo = modelList.find((m) => m.id === settingsForm.model);

 return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Left Sidebar: Conversation List ───────────────────── */}
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
          activeConvId={activeConvId!}
          activeProvider={activeProvider ?? null}
          currentModelCaps={currentModelCaps}
          onToggleSidebar={() => setShowSidebar(true)}
          onToggleSettings={() => setShowSettings(!showSettings)}
          onClearMessages={async () => {
            if (!confirm("确定清空此对话的所有消息？此操作不可恢复。")) return;
            try {
              await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clearMessages: true }),
              });
              setMessages([]);
            } catch { /* ignore */ }
          }}
          onRenameConv={() => {
            const title = prompt("修改对话标题", activeConv.title);
            if (title?.trim()) {
              csrfFetch(`/api/ai/conversations/${activeConvId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title.trim() }),
              }).then(() => refreshConversations());
            }
          }}
          onExportConv={async () => {
            try {
              const data = await csrfFetch(`/api/ai/conversations/${activeConvId}`);
const conv = data.conversation;
              if (!conv) return;
              const exportText = [
                `# ${conv.title}`,
                `模型: ${conv.model} | 提供商: ${activeProvider?.name || "未知"}`,
                `创建: ${conv.createdAt}`,
                "",
                ...conv.messages.map((m: Message) => {
                  const role = m.role === "user" ? "👤 用户" : m.role === "assistant" ? "🤖 助手" : "系统";
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
        {/* Settings panel */}
        <AiSettingsPanel
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
                  <p className="text-sm">发送消息开始对话</p>
                  <p className="text-xs mt-1 text-slate-700">
                    支持: {formatAllowedTypes(currentModelCaps)} · 拖拽/粘贴上传
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
                          💭 思考过程
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
								<img
									key={i}
									src={url}
									alt={`附件 ${i + 1}`}
									className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-white/10"
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = "none";
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
    {copyFeedback === msg.id ? "已复制" : "复制"}
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
                        <summary className="text-[10px] text-cyan-400/60 cursor-pointer">💭 正在思考...</summary>
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
                    正在思考...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
 {/* AI托管审批面板 */}
 {pendingApprovals.length > 0 && (
  <div className="px-4 py-2 border-t border-amber-500/20 bg-amber-950/30">
   <div className="text-xs text-amber-400 font-medium mb-2">🔒 待审批操作 ({pendingApprovals.length})</div>
   <div className="space-y-2">
    {pendingApprovals.map((approval) => (
     <div key={approval.actionId} className="flex items-center justify-between bg-black/30 rounded-lg p-2.5">
      <div className="flex-1 min-w-0">
       <div className="text-sm text-white font-medium">{approval.actionName}</div>
       <div className="text-xs text-slate-400 truncate">
 风险: <span className={
 approval.riskLevel === "critical" ? "text-red-400" :
 approval.riskLevel === "high" ? "text-orange-400" :
 approval.riskLevel === "medium" ? "text-yellow-400" : "text-green-400"
 }>{approval.riskLevel}</span>
 {typeof approval.params.serverId === "string" && <span className="ml-2">服务器: {approval.params.serverId}</span>}
       </div>
      </div>
      <div className="flex gap-2 ml-3">
       <button
        className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white transition"
        onClick={async () => {
         try {
          await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
           method: "PATCH",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ action: "reject", reason: "用户拒绝" }),
          });
          setPendingApprovals((prev) => prev.filter((a) => a.actionId !== approval.actionId));
          addToast("success", "已拒绝操作");
         } catch { addToast("error", "操作失败"); }
        }}
       >拒绝</button>
       <button
        className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white transition"
        onClick={async () => {
          try {
          await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
           method: "PATCH",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ action: "approve" }),
          });
          setPendingApprovals((prev) => prev.filter((a) => a.actionId !== approval.actionId));
          addToast("success", "已批准并执行操作");
         } catch { addToast("error", "操作失败"); }
        }}
       >批准</button>
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
					<img src={url} alt="" width={48} height={48} loading="lazy" className="w-12 h-12 rounded object-cover border border-white/10" />
                      <button
                        onClick={() => setImageUrls((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                {/* File attachments */}
                {fileAttachments.map((file, i) => (
                  <div key={`file-${i}`} className="relative group">
 {file.type === "image" && file.preview ? (
						<img src={file.preview} alt={file.name} width={48} height={48} loading="lazy" className="w-12 h-12 rounded object-cover border border-white/10" />
                    ) : (
                      <div className="w-12 h-12 rounded border border-white/10 bg-black/30 flex flex-col items-center justify-center">
                        {file.mimeType.startsWith("video/") ? (
                          <span className="text-base" title="视频文件">🎬</span>
                        ) : file.mimeType.startsWith("audio/") ? (
                          <span className="text-base" title="音频文件">🎵</span>
                        ) : file.mimeType === "application/pdf" || file.mimeType.includes("officedocument") ? (
                          <span className="text-base" title="文档文件">📑</span>
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
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
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
                    placeholder="输入图片 URL（回车添加）"
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

            {/* Input area */}
            <div className="px-4 py-3 border-t border-white/[0.06] bg-slate-950/30">
              {/* File rejection toast */}
              {fileRejectionMsg && (
                <div className="mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{fileRejectionMsg}</span>
                  <button onClick={() => setFileRejectionMsg(null)} className="ml-auto text-red-400/60 hover:text-red-300 flex-shrink-0">×</button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                {/* File upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming}
                  className="h-10 w-10 rounded-xl bg-white/[0.04] text-slate-400 flex items-center justify-center hover:bg-white/[0.08] hover:text-slate-200 transition disabled:opacity-30"
                  title={`上传文件 (支持: ${formatAllowedTypes(currentModelCaps)})`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 11-12.728 0M12 3v12" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={buildAcceptString(currentModelCaps)}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFileSelect(e.target.files);
                    e.target.value = "";
                  }}
                />
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    activeConv.enableVision
                      ? `输入消息... (Shift+Enter 换行，支持: ${formatAllowedTypes(currentModelCaps)})`
                      : `输入消息... (Shift+Enter 换行，📎 可上传 ${formatAllowedTypes(currentModelCaps)})`
                  }
                  rows={1}
                  disabled={streaming}
                  className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-400/30 transition disabled:opacity-50"
                  style={{ maxHeight: "120px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 120) + "px";
                  }}
                />
            <button
              onClick={handleSend}
              disabled={streaming || (!input.trim() && fileAttachments.length === 0)}
              className="h-10 w-10 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center hover:bg-cyan-500/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
            {streaming && (
              <button
                onClick={handleStopGeneration}
                className="h-10 w-10 rounded-xl bg-red-500/20 text-red-300 flex items-center justify-center hover:bg-red-500/30 transition"
                title="停止生成"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            )}
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
            <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25" />
            </svg>
            <p className="text-sm mb-3">选择一个对话或创建新对话</p>
            <button
              onClick={handleNewConv}
              className="h-9 px-4 rounded-xl bg-cyan-500/20 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition"
            >
              + 新对话
            </button>
            {providers.length === 0 && (
              <p className="mt-4 text-xs text-amber-400/60">
                ⚠ 还未配置 AI 提供商，请先在下方添加
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Provider Management Panel (overlay) ─────────────────── */}
      <AiProviderPanel
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
