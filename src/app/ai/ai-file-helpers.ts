/* ── AI Chat File Helpers ──────────────────────────────────── */

import type { ModelCapabilities, FileCategory } from "./ai-types";

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isTextFile(file: File): boolean {
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
    ".swift", ".kt", ".scala", ".r", ".m",
  ];
  return textExts.some((ext) => file.name.toLowerCase().endsWith(ext));
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v|3gp)$/i.test(file.name);
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i.test(file.name);
}

export function isDocumentFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || /\.xlsx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || /\.pptx$/i.test(file.name) ||
    file.type === "application/msword" || /\.doc$/i.test(file.name);
}

export function categorizeFile(file: File): FileCategory {
  if (isImageFile(file)) return "image";
  if (isVideoFile(file)) return "video";
  if (isAudioFile(file)) return "audio";
  if (isDocumentFile(file)) return "document";
  if (isTextFile(file)) return "text";
  return "unsupported";
}

/** Format allowed types for the current model (for error messages) */
export function formatAllowedTypes(caps: ModelCapabilities, t: (key: string) => string): string {
  const parts: string[] = [t("aiPage.allowedType.text")];
  if (caps.vision) parts.push(t("aiPage.allowedType.image"));
  if (caps.video) parts.push(t("aiPage.allowedType.video"));
  if (caps.audio) parts.push(t("aiPage.allowedType.audio"));
  if (caps.document) parts.push(t("aiPage.allowedType.document"));
  return parts.join(t("aiPage.allowedType.separator"));
}

/** Build the accept string for the file input based on capabilities */
export function buildAcceptString(caps: ModelCapabilities): string {
  const parts: string[] = [".txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.sql,.html,.css,.toml,.ini,.env,.log"];
  if (caps.vision) parts.push("image/*");
  if (caps.video) parts.push("video/*");
  if (caps.audio) parts.push("audio/*");
  if (caps.document) parts.push(".pdf,.docx,.xlsx,.pptx,.doc");
  return parts.join(",");
}

/** Client-side model capability detection (mirrors server logic) */
export function detectCapabilities(modelId: string): ModelCapabilities {
  const v = modelId.toLowerCase();
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
