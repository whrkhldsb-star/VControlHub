export type StorageUploadNode = { id: string; name: string; driver: string };
export type UploadMessage = { type: "success" | "error"; text: string } | null;
export type BrowserFileWithRelativePath = File & { webkitRelativePath?: string };
export type PathValidationError =
  | "controlChars"
  | "absolutePath"
  | "dotSegments"
  | "segmentTooLong"
  | "pathTooLong";
export type PathResult =
  | { ok: true; path: string }
  | { ok: false; reason: PathValidationError };

export const DEFAULT_NODE = "";
export const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
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
  // : * ? " < > | are ordinary in Linux names, as the server, rename and new
  // folder accept them; a node on Windows refuses them itself. Refused here,
  // such a file could be renamed into place but never uploaded.
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

export function formatUploadMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
