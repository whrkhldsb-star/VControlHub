export type StorageUploadNode = { id: string; name: string; driver: string };
export type UploadMessage = { type: "success" | "error"; text: string } | null;
export type UploadQueueItem = {
  name: string;
  status: "pending" | "uploading" | "success" | "error";
  message: string;
};
export type BrowserFileWithRelativePath = File & { webkitRelativePath?: string };
export type PathValidationError =
  | "controlChars"
  | "dangerousChars"
  | "absolutePath"
  | "dotSegments"
  | "segmentTooLong"
  | "pathTooLong";
export type PathResult =
  | { ok: true; path: string }
  | { ok: false; reason: PathValidationError };

export const DEFAULT_NODE = "";
export const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
export const DANGEROUS_CHAR_PATTERN = /[<>:"|?*]/;
export const MAX_SEGMENT_LENGTH = 255;
export const MAX_PATH_LENGTH = 4096;

export function normalizeRelativePath(input: string): PathResult {
  const value = input.trim();
  if (!value) {
    return { ok: true, path: "" };
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return { ok: false, reason: "controlChars" };
  }
  if (DANGEROUS_CHAR_PATTERN.test(value)) {
    return { ok: false, reason: "dangerousChars" };
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return { ok: false, reason: "absolutePath" };
  }
  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "dotSegments" };
  }
  if (segments.some((segment) => segment.length > MAX_SEGMENT_LENGTH)) {
    return { ok: false, reason: "segmentTooLong" };
  }
  const path = segments.join("/");
  if (path.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: "pathTooLong" };
  }
  return { ok: true, path };
}

export function getBrowserRelativePath(file: File) {
  const browserFile = file as BrowserFileWithRelativePath;
  return browserFile.webkitRelativePath?.trim() || file.name;
}

export function getUploadDisplayPath(file: File) {
  return getBrowserRelativePath(file);
}

export function formatUploadMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
