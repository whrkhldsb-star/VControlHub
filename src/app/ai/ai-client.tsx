"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

/* ── Types ──────────────────────────────────────────────────── */
interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  availableModels: string;
  isDefault: boolean;
  enabled: boolean;
  settings: string;
  createdAt: string;
  updatedAt: string;
}

interface ConvItem {
  id: string;
  title: string;
  providerId: string;
  model: string;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  enableVision: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; name: string; type: string } | null;
}

interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  reasoningContent: string | null;
  imageUrls: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

interface ModelInfo {
  id: string;
  name: string;
  owned_by?: string;
  vision?: boolean;
  context_length?: number;
  capabilities?: ModelCapabilities;
}

interface ModelCapabilities {
  vision: boolean;
  document: boolean;
  video: boolean;
  audio: boolean;
}

interface FileAttachment {
  name: string;
  content: string;
  type: "text" | "image";
  mimeType: string;
  base64Data?: string; // for images
  preview?: string; // for display
}

/** Client-side model capability detection (mirrors server logic) */
function detectCapabilities(modelId: string): ModelCapabilities {
  const v = modelId.toLowerCase();
  // Vision: o1/o3/o4 only specific variants support images
  const isO1Vision = v.includes("o1") && !v.includes("o1-mini") && !v.includes("o1-preview") && v.includes("o1-");
  const isO3Vision = v.includes("o3") && !v.includes("o3-mini");
  const isO4Vision = v.includes("o4");
  const vision =
    v.includes("vision") || v.includes("gpt-4o") || v.includes("gpt-4-turbo") ||
    v.includes("gpt4-turbo") || v.includes("gpt-4e") || v.includes("claude-3") ||
    v.includes("claude-3.5") || v.includes("claude-4") || v.includes("gemini") ||
    v.includes("qwen-vl") || v.includes("qwen2-vl") || v.includes("qwen2.5-vl") ||
    v.includes("glm-4v") || v.includes("llava") || v.includes("internvl") ||
    v.includes("cogvlm") || v.includes("minicpm-v") || v.includes("pixtral") ||
    isO1Vision || isO3Vision || isO4Vision ||
    v.includes("deepseek-vl") || v.includes("yi-vision");
  const document =
    v.includes("gemini-1.5") || v.includes("gemini-2") || v.includes("gemini-pro") ||
    v.includes("claude-3.5-sonnet") || v.includes("claude-3.5-haiku") ||
    v.includes("claude-4") || v.includes("gpt-4o") || isO1Vision ||
    isO3Vision || isO4Vision;
  const video =
    v.includes("gemini-1.5") || v.includes("gemini-2") || v.includes("gemini-pro") ||
    v.includes("qwen2-vl") || v.includes("qwen2.5-vl") || v.includes("gpt-4o") ||
    v.includes("claude-4");
  const audio =
    v.includes("gemini-2") || v.includes("gpt-4o-audio") || v.includes("gpt-4o-realtime") ||
    isO4Vision;
  return { vision, document, video, audio };
}

/* ── Helper: read file as text ──────────────────────────────── */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Helper: check if file is a text file ───────────────────── */
function isTextFile(file: File): boolean {
  const textTypes = [
    "text/", "application/json", "application/xml", "application/javascript",
    "application/typescript", "application/x-yaml", "application/yaml",
    "application/x-sh", "application/x-shellscript",
  ];
  if (textTypes.some((t) => file.type.startsWith(t))) return true;
  const textExts = [
    ".txt", ".md", ".csv", ".log", ".json", ".xml", ".yaml", ".yml",
    ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".java",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh",
    ".sql", ".html", ".css", ".scss", ".less", ".toml", ".ini", ".cfg",
    ".env", ".gitignore", ".dockerfile", ".makefile", ".cmake",
    ".rs", ".swift", ".kt", ".scala", ".r", ".m",
  ];
  return textExts.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v|3gp)$/i.test(file.name);
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i.test(file.name);
}

function isDocumentFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || /\.xlsx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || /\.pptx$/i.test(file.name) ||
    file.type === "application/msword" || /\.doc$/i.test(file.name);
}

type FileCategory = "image" | "video" | "audio" | "document" | "text" | "unsupported";

function categorizeFile(file: File): FileCategory {
  if (isImageFile(file)) return "image";
  if (isVideoFile(file)) return "video";
  if (isAudioFile(file)) return "audio";
  if (isDocumentFile(file)) return "document";
  if (isTextFile(file)) return "text";
  return "unsupported";
}

/** Format allowed types for the current model (for error messages) */
function formatAllowedTypes(caps: ModelCapabilities): string {
  const parts: string[] = ["文本文件"];
  if (caps.vision) parts.push("图片");
  if (caps.video) parts.push("视频");
  if (caps.audio) parts.push("音频");
  if (caps.document) parts.push("PDF/文档");
  return parts.join("、");
}

/** Build the accept string for the file input based on capabilities */
function buildAcceptString(caps: ModelCapabilities): string {
  const parts: string[] = [".txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.sql,.html,.css,.toml,.ini,.env,.log"];
  if (caps.vision) parts.push("image/*");
  if (caps.video) parts.push("video/*");
  if (caps.audio) parts.push("audio/*");
  if (caps.document) parts.push(".pdf,.docx,.xlsx,.pptx,.doc");
  return parts.join(",");
}

/* ── Main Component ─────────────────────────────────────────── */
export function AiClient({
  userId,
  initialProviders,
  initialConversations,
}: {
  userId: string;
  initialProviders: Provider[];
  initialConversations: ConvItem[];
}) {
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
    fetch(`/api/ai/conversations/${activeConvId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.conversation?.messages) setMessages(data.conversation.messages);
      })
      .catch(() => {});
  }, [activeConvId]);

  // Fetch models when provider changes
  const fetchModels = useCallback(async (providerId: string) => {
    setModelsLoading(true);
    try {
      const r = await fetch(`/api/ai/models?providerId=${providerId}`);
      const data = await r.json();
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
    const r = await fetch("/api/ai/conversations");
    const data = await r.json();
    if (data.conversations) setConversations(data.conversations);
  }, []);

  const refreshProviders = useCallback(async () => {
    const r = await fetch("/api/ai/providers");
    const data = await r.json();
    if (data.providers) setProviders(data.providers);
  }, []);

  /* ── File Handling (capability-aware) ─────────────────────── */
  const showRejection = useCallback((msg: string) => {
    setFileRejectionMsg(msg);
    setTimeout(() => setFileRejectionMsg(null), 4000);
  }, []);

  const handleFileSelect = async (files: FileList | File[]) => {
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
  };

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
      fetch(`/api/ai/conversations/${activeConvId}`)
        .then((r) => r.json())
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
      id: `temp-${Date.now()}`,
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
    const response = await fetch("/api/ai/chat", {
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
                id: `stream-${Date.now()}`,
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
        fetch(`/api/ai/conversations/${activeConvId}`)
          .then((r) => r.json())
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
      alert("请先添加一个 AI 提供商");
      setShowProviders(true);
      return;
    }
    try {
      const r = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: defaultProvider.id,
          model: defaultProvider.defaultModel,
        }),
      });
      const data = await r.json();
      if (data.conversation) {
        await refreshConversations();
        setActiveConvId(data.conversation.id);
      }
    } catch {
      alert("创建对话失败");
    }
  };

  /* ── Auto-title: generate from first message ──────────────── */
  const autoTitle = useCallback(async (convId: string, firstMsg: string) => {
    const title = firstMsg.slice(0, 30).replace(/\n/g, " ").trim();
    if (!title || title === "(附件)") return;
    try {
      await fetch(`/api/ai/conversations/${convId}`, {
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
    await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    if (activeConvId === id) setActiveConvId(null);
    refreshConversations();
  };

/* ── Escape HTML to prevent XSS ──────────────────────────────── */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ── Copy to clipboard ──────────────────────────────────────── */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ── Render inline markdown (bold, italic, code, links, strikethrough) ─ */
const renderInline = (text: string): React.ReactNode[] => {
 // Split by inline code first, then process formatting in non-code parts
 const codeParts = text.split(/(`[^`]+`)/g);
 const result: React.ReactNode[] = [];
 codeParts.forEach((cp, ci) => {
 if (cp.startsWith("`") && cp.endsWith("`")) {
 result.push(
 <code key={`c-${ci}`} className="bg-black/30 px-1.5 py-0.5 rounded text-cyan-300 text-xs">
 {cp.slice(1, -1)}
 </code>
 );
 return;
 }
 // Process formatting: **bold**, *italic*, ~~strike~~, [link](url)
 const fmtParts = cp.split(/(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g);
 fmtParts.forEach((fp, fi) => {
 if (fp.startsWith("**") && fp.endsWith("**")) {
 result.push(<strong key={`b-${ci}-${fi}`}>{fp.slice(2, -2)}</strong>);
 } else if (fp.startsWith("*") && fp.endsWith("*") && !fp.startsWith("**")) {
 result.push(<em key={`i-${ci}-${fi}`}>{fp.slice(1, -1)}</em>);
 } else if (fp.startsWith("~~") && fp.endsWith("~~")) {
 result.push(<s key={`s-${ci}-${fi}`}>{fp.slice(2, -2)}</s>);
 } else if (/^\[.+\]\(.+\)$/.test(fp)) {
 const linkMatch = fp.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
 if (linkMatch) {
 result.push(
 <a key={`a-${ci}-${fi}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
 className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/30">
 {linkMatch[1]}
 </a>
 );
 } else {
 result.push(<span key={`t-${ci}-${fi}`}>{escapeHtml(fp)}</span>);
 }
 } else {
 result.push(<span key={`t-${ci}-${fi}`}>{escapeHtml(fp)}</span>);
 }
 });
 });
 return result;
};

/* ── Render Message Content (full markdown: headings, lists, links, code, tables) ─ */
const renderContent = (content: string) => {
 // 1. Extract fenced code blocks first (they must not be processed)
 const codeBlocks: string[] = [];
 const withoutCode = content.replace(/(```[\s\S]*?```)/g, (m) => {
 codeBlocks.push(m);
 return `\x00CODE${codeBlocks.length - 1}\x00`;
 });

 // 2. Split into lines for block-level processing
 const lines = withoutCode.split("\n");
 const elements: React.ReactNode[] = [];
 let i = 0;
 let listItems: string[] = [];
 let listType: "ul" | "ol" | null = null;
 let tableRows: string[][] = [];
 let inTable = false;

 const flushList = () => {
 if (listItems.length > 0) {
 const Tag = listType === "ol" ? "ol" : "ul";
 elements.push(
 <Tag key={`list-${elements.length}`} className={`ml-4 my-1.5 ${listType === "ol" ? "list-decimal" : "list-disc"} text-xs text-slate-300 space-y-0.5`}>
 {listItems.map((li, liIdx) => (
 <li key={liIdx}>{renderInline(li)}</li>
 ))}
 </Tag>
 );
 listItems = [];
 listType = null;
 }
 };

 const flushTable = () => {
 if (tableRows.length > 0) {
 elements.push(
 <div key={`tbl-${elements.length}`} className="my-2 overflow-x-auto">
 <table className="text-xs border-collapse w-full">
 <thead>
 <tr>
 {tableRows[0]?.map((cell, ci) => (
 <th key={ci} className="border border-white/10 px-2 py-1 text-left text-cyan-400/80 bg-black/20">{renderInline(cell)}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {tableRows.slice(1).map((row, ri) => (
 <tr key={ri}>
 {row.map((cell, ci) => (
 <td key={ci} className="border border-white/10 px-2 py-1 text-slate-300">{renderInline(cell)}</td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
 tableRows = [];
 inTable = false;
 }
 };

 while (i < lines.length) {
 const line = lines[i];

 // Check for code block placeholder
 const codeMatch = line.match(/^\x00CODE(\d+)\x00$/);
 if (codeMatch) {
 flushList();
 flushTable();
 const block = codeBlocks[parseInt(codeMatch[1])];
 const blockLines = block.slice(3, -3).split("\n");
 const lang = blockLines[0]?.trim() || "";
 const code = lang ? blockLines.slice(1).join("\n") : blockLines.join("\n");
 elements.push(
 <div key={`cb-${elements.length}`} className="relative group/code bg-black/40 rounded-lg my-2 overflow-hidden">
 <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
 <span className="text-[10px] text-cyan-400/60 font-mono">{lang || "code"}</span>
 <button
 onClick={() => copyToClipboard(code)}
 className="text-[10px] text-slate-500 hover:text-cyan-300 transition opacity-0 group-hover/code:opacity-100 flex items-center gap-1"
 >
 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
 </svg>
 复制
 </button>
 </div>
 <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
 <code>{code}</code>
 </pre>
 </div>
 );
 i++;
 continue;
 }

 // Headings: # ## ### etc.
 const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
 if (headingMatch) {
 flushList(); flushTable();
 const level = headingMatch[1].length;
 const sizes: Record<number, string> = {
 1: "text-base font-bold", 2: "text-sm font-bold", 3: "text-sm font-semibold",
 4: "text-xs font-semibold", 5: "text-xs font-medium", 6: "text-xs font-medium text-slate-400",
 };
 elements.push(
 <div key={`h-${elements.length}`} className={`${sizes[level] || "text-xs"} text-white mt-3 mb-1`}>
 {renderInline(headingMatch[2])}
 </div>
 );
 i++;
 continue;
 }

 // Unordered list: - or * with space
 const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
 if (ulMatch) {
 flushTable();
 if (listType !== "ul") { flushList(); listType = "ul"; }
 listItems.push(ulMatch[1]);
 i++;
 continue;
 }

 // Ordered list: 1. 2. etc.
 const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
 if (olMatch) {
 flushTable();
 if (listType !== "ol") { flushList(); listType = "ol"; }
 listItems.push(olMatch[1]);
 i++;
 continue;
 }

 // Table row: | cell | cell |
 const tableMatch = line.match(/^\|(.+)\|$/);
 if (tableMatch) {
 flushList();
 const cells = tableMatch[1].split("|").map(c => c.trim());
 // Skip separator row: |---|---|
 if (cells.every(c => /^[-:]+$/.test(c))) {
 i++;
 continue;
 }
 tableRows.push(cells);
 inTable = true;
 i++;
 continue;
 }

 // Horizontal rule: --- or ***
 if (/^[-*_]{3,}\s*$/.test(line.trim())) {
 flushList(); flushTable();
 elements.push(<hr key={`hr-${elements.length}`} className="border-white/10 my-3" />);
 i++;
 continue;
 }

 // Blank line → paragraph break
 if (line.trim() === "") {
 flushList(); flushTable();
 i++;
 continue;
 }

 // Default: paragraph text
 flushList(); flushTable();
 // Collect consecutive text lines as one paragraph
 const paraLines: string[] = [];
 while (i < lines.length) {
 const l = lines[i];
 if (l.trim() === "" || l.match(/^\x00CODE/) || l.match(/^#{1,6}\s+/) ||
 l.match(/^[\s]*[-*]\s+/) || l.match(/^[\s]*\d+\.\s+/) || l.match(/^\|/)) break;
 paraLines.push(l);
 i++;
 }
 if (paraLines.length > 0) {
 elements.push(
 <p key={`p-${elements.length}`} className="my-1">
 {renderInline(paraLines.join("\n"))}
 </p>
 );
 }
 }

 flushList();
 flushTable();

 return elements;
};

  /* ── Provider Form State ────────────────────────────────────── */
  const [provForm, setProvForm] = useState({
    name: "",
    type: "OPENAI_COMPATIBLE",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    availableModels: "",
    isDefault: true,
  });

  const handleCreateProvider = async () => {
    if (!provForm.name.trim() || !provForm.apiKey.trim()) {
      alert("名称和 API Key 不能为空");
      return;
    }
    const models = provForm.availableModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    try {
      await fetch("/api/ai/providers", {
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
      alert("添加失败");
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm("确定删除此提供商？关联的对话也会被删除。")) return;
    await fetch(`/api/ai/providers/${id}`, { method: "DELETE" });
    if (activeConv?.providerId === id) setActiveConvId(null);
    refreshProviders();
    refreshConversations();
  };

  /* ── Settings Update ───────────────────────────────────────── */
  const [settingsForm, setSettingsForm] = useState({
    model: "",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1.0,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    enableVision: false,
  });

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
      });
    }
  }, [activeConv]);

  const handleSaveSettings = async () => {
    if (!activeConvId) return;
    try {
      await fetch(`/api/ai/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      await refreshConversations();
      setShowSettings(false);
    } catch {
      alert("保存失败");
    }
  };

  // Auto-detect vision from selected model
  const selectedModelInfo = modelList.find((m) => m.id === settingsForm.model);
  const currentModelSupportsVision = selectedModelInfo?.vision || false;

  const providerTypes: Record<string, string> = {
    OPENAI: "OpenAI",
    OPENAI_COMPATIBLE: "OpenAI 兼容",
    ANTHROPIC: "Anthropic",
    GOOGLE: "Google AI",
    CUSTOM: "自定义",
  };

  const commonBaseUrls: Record<string, string> = {
    OPENAI: "https://api.openai.com/v1",
    OPENAI_COMPATIBLE: "",
    ANTHROPIC: "https://api.anthropic.com/v1",
    GOOGLE: "https://generativelanguage.googleapis.com/v1beta",
    CUSTOM: "",
  };

  // Filter models by search
  const filteredModels = modelList.filter((m) =>
    m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.name.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* ── Left Sidebar: Conversation List ───────────────────── */}
      {/* Mobile sidebar backdrop */}
      {showSidebar && (
        <div className="hidden max-md:block fixed inset-0 z-30 bg-black/50" onClick={() => setShowSidebar(false)} />
      )}
      {showSidebar && (
        <div className="w-64 flex-shrink-0 border-r border-white/[0.06] bg-slate-950/50 flex flex-col max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">AI 助手</h2>
            <button
              onClick={handleNewConv}
              className="h-7 px-2.5 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition"
            >
              + 新对话
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
            {conversations.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-8">暂无对话，点击新建开始</p>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition ${
                  activeConvId === conv.id
                    ? "bg-cyan-400/[0.08] text-cyan-100"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
                onClick={() => setActiveConvId(conv.id)}
              >
                <svg className="w-4 h-4 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="text-xs truncate flex-1">{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConv(conv.id);
                  }}
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
              onClick={() => setShowProviders(!showProviders)}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" />
              </svg>
              提供商管理
            </button>
            <button
              onClick={() => setShowSidebar(false)}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition lg:hidden"
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
          onClick={() => setShowSidebar(true)}
          className="absolute top-4 left-4 z-50 lg:hidden rounded-xl border border-white/10 bg-slate-950/90 p-2.5 text-slate-200 backdrop-blur hover:bg-white/10 transition"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* ── Main Chat Area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
      {activeConv ? (
        <>
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3 bg-slate-950/30">
            {/* Mobile sidebar toggle */}
            <button
              onClick={() => setShowSidebar(true)}
              className="md:hidden flex-shrink-0 text-slate-400 hover:text-slate-200 transition"
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
 onClick={() => setShowSettings(!showSettings)}
 className="h-7 px-2.5 rounded-lg text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition"
 >
 ⚙ 设置
 </button>
 <button
 onClick={async () => {
 if (!confirm("确定清空此对话的所有消息？此操作不可恢复。")) return;
 try {
 await fetch(`/api/ai/conversations/${activeConvId}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ clearMessages: true }),
 });
 setMessages([]);
 } catch { /* ignore */ }
 }}
 className="h-7 px-2.5 rounded-lg text-xs text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition"
 title="清空对话消息"
 >
 🗑 清空
 </button>
                <button
                  onClick={() => {
                    const title = prompt("修改对话标题", activeConv.title);
                    if (title?.trim()) {
                      fetch(`/api/ai/conversations/${activeConvId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: title.trim() }),
                      }).then(() => refreshConversations());
                    }
                  }}
                  className="h-7 px-2.5 rounded-lg text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition"
                >
                  ✏ 重命名
                </button>
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`/api/ai/conversations/${activeConvId}`);
                      const data = await r.json();
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
                  className="h-7 px-2.5 rounded-lg text-xs text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition"
                  title="导出对话为 Markdown"
                >
                  📥 导出
                </button>
              </div>
            </div>

            {/* Settings panel */}
            {showSettings && (
              <div className="border-b border-white/[0.06] bg-slate-950/50 p-4 max-h-[50vh] overflow-y-auto">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Model selector — dropdown from API */}
                  <div className="col-span-2 md:col-span-2 relative">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      模型
                      {modelsLoading && <span className="ml-2 text-cyan-400 animate-pulse">加载中...</span>}
                    </label>
                    <div className="relative mt-1">
                      <button
                        onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                        className="w-full flex items-center justify-between bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white hover:border-cyan-400/30 transition"
                      >
                        <span className="truncate flex items-center gap-1.5">
                          {settingsForm.model}
                          {currentModelSupportsVision && (
                            <span className="text-[9px] text-cyan-400 bg-cyan-400/10 px-1 py-0.5 rounded">👁</span>
                          )}
                        </span>
                        <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {modelDropdownOpen && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl max-h-60 overflow-hidden flex flex-col">
                          <div className="p-2 border-b border-white/5">
                            <input
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              placeholder="搜索模型..."
                              className="w-full bg-black/30 border border-white/5 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400/30"
                              autoFocus
                            />
                          </div>
                          <div className="overflow-y-auto max-h-48">
                            {filteredModels.length === 0 && !modelsLoading && (
                              <div className="px-3 py-4 text-xs text-slate-500 text-center">
                                无可用模型
                                <button
                                  onClick={() => activeConv?.providerId && fetchModels(activeConv.providerId)}
                                  className="ml-2 text-cyan-400 hover:text-cyan-300"
                                >
                                  刷新
                                </button>
                              </div>
                            )}
                            {filteredModels.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => {
                                  setSettingsForm((f) => ({
                                    ...f,
                                    model: m.id,
                                    // Auto-enable vision if model supports it
                                    enableVision: m.vision ? true : f.enableVision,
                                  }));
                                  setModelDropdownOpen(false);
                                  setModelSearch("");
                                }}
                                className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.04] transition flex items-center gap-2 ${
                                  settingsForm.model === m.id ? "text-cyan-300 bg-cyan-400/[0.06]" : "text-white"
                                }`}
                              >
                                <span className="truncate flex-1">{m.id}</span>
                                {/* Capability badges */}
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  {(m.capabilities?.vision || m.vision) && (
                                    <span className="text-[9px] text-cyan-400/60" title="支持图片">👁</span>
                                  )}
                                  {m.capabilities?.video && (
                                    <span className="text-[9px] text-blue-400/60" title="支持视频">🎬</span>
                                  )}
                                  {m.capabilities?.audio && (
                                    <span className="text-[9px] text-purple-400/60" title="支持音频">🎵</span>
                                  )}
                                  {m.capabilities?.document && (
                                    <span className="text-[9px] text-green-400/60" title="支持文档">📑</span>
                                  )}
                                </span>
                                {m.context_length && (
                                  <span className="text-[9px] text-slate-600 flex-shrink-0">
                                    {(m.context_length / 1000).toFixed(0)}k
                                  </span>
                                )}
                                {m.owned_by && (
                                  <span className="text-[9px] text-slate-600 flex-shrink-0 truncate max-w-[60px]">
                                    {m.owned_by}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                          {/* Manual model input fallback */}
                          <div className="border-t border-white/5 p-2">
                            <div className="flex gap-1.5">
                              <input
                                value={modelSearch || settingsForm.model}
                                onChange={(e) => setModelSearch(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && modelSearch.trim()) {
                                    setSettingsForm((f) => ({ ...f, model: modelSearch.trim() }));
                                    setModelDropdownOpen(false);
                                    setModelSearch("");
                                  }
                                }}
                                placeholder="手动输入模型 ID..."
                                className="flex-1 bg-black/30 border border-white/5 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none"
                              />
                              <button
                                onClick={() => {
                                  if (modelSearch.trim()) {
                                    setSettingsForm((f) => ({ ...f, model: modelSearch.trim() }));
                                    setModelDropdownOpen(false);
                                    setModelSearch("");
                                  }
                                }}
                                className="px-2 py-1 text-[10px] bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30"
                              >
                                应用
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Temperature slider */}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Temperature <span className="text-cyan-400/70">{settingsForm.temperature.toFixed(2)}</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.01}
                        value={settingsForm.temperature}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))}
                        className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Max Tokens */}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Max Tokens
                    </label>
                    <select
                      value={settingsForm.maxTokens}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) }))}
                      className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {[512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 128000].map((v) => (
                        <option key={v} value={v}>{v.toLocaleString()}</option>
                      ))}
                    </select>
                  </div>

                  {/* Top P slider */}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Top P <span className="text-cyan-400/70">{settingsForm.topP.toFixed(2)}</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={settingsForm.topP}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, topP: parseFloat(e.target.value) }))}
                        className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Frequency Penalty slider */}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      频率惩罚 <span className="text-cyan-400/70">{settingsForm.frequencyPenalty.toFixed(2)}</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={0.01}
                        value={settingsForm.frequencyPenalty}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, frequencyPenalty: parseFloat(e.target.value) }))}
                        className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Presence Penalty slider */}
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">
                      存在惩罚 <span className="text-cyan-400/70">{settingsForm.presencePenalty.toFixed(2)}</span>
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={0.01}
                        value={settingsForm.presencePenalty}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, presencePenalty: parseFloat(e.target.value) }))}
                        className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Vision toggle */}
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settingsForm.enableVision}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, enableVision: e.target.checked }))}
                        className="rounded border-white/20 bg-black/30 text-cyan-400 focus:ring-cyan-400/30"
                      />
                      <span className="text-xs text-slate-300">
                        👁 多模态 (视觉)
                        {currentModelSupportsVision && (
                          <span className="text-[9px] text-cyan-400/60 ml-1">推荐</span>
                        )}
                      </span>
                    </label>
                  </div>

                  {/* Save button */}
                  <div className="flex items-end gap-2">
                    <button
                      onClick={handleSaveSettings}
                      className="h-7 px-3 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition"
                    >
                      保存设置
                    </button>
                  </div>
                </div>

                {/* System prompt */}
                <div className="mt-3">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">系统提示词 (System Prompt)</label>
                  <textarea
                    value={settingsForm.systemPrompt}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                    rows={2}
                    placeholder="设定 AI 的角色和行为方式..."
                    className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-400/30"
                  />
                </div>
              </div>
            )}

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
            </div>

            {/* File/Attachment preview area */}
            {(fileAttachments.length > 0 || (activeConv.enableVision && imageUrls.length > 0)) && (
              <div className="px-4 pb-1.5 border-t border-white/[0.03] bg-slate-950/20">
                <div className="flex flex-wrap gap-2 py-2">
                  {/* URL-based images */}
                  {imageUrls.map((url, i) => (
                    <div key={`url-${i}`} className="relative group">
                      <img src={url} alt="" className="w-12 h-12 rounded object-cover border border-white/10" />
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
                      <img src={file.preview} alt={file.name} className="w-12 h-12 rounded object-cover border border-white/10" />
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
      {showProviders && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">AI 提供商管理</h3>
              <button
                onClick={() => setShowProviders(false)}
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
                {providerTypes[p.type] || p.type}
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
                  await fetch(`/api/ai/providers/${p.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !p.enabled }),
                  });
                  refreshProviders();
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
                    await fetch(`/api/ai/providers/${p.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patchBody),
                    });
                    refreshProviders();
                  } catch { alert("更新失败"); }
                }
              }}
              className="text-xs text-cyan-400/60 hover:text-cyan-400 transition"
            >
              编辑
            </button>
            <button
              onClick={() => handleDeleteProvider(p.id)}
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
                          baseUrl: commonBaseUrls[t] || f.baseUrl,
                        }));
                      }}
                      className="w-full mt-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      {Object.entries(providerTypes).map(([k, v]) => (
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
                  onClick={handleCreateProvider}
                  className="w-full h-9 rounded-xl bg-cyan-500/20 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition"
                >
                  添加提供商
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
