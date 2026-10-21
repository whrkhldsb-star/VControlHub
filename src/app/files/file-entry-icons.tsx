import type { CSSProperties } from "react";
import type { StorageEntry } from "./file-entry-utils";

export function PreviewIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** What a file is, for its icon and for choosing how to open it. */
export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "archive"
  | "code"
  | "text"
  | "file";

const EXTENSION_KINDS: Record<string, FileKind> = {};
function register(kind: FileKind, extensions: string) {
  for (const extension of extensions.split(" ")) EXTENSION_KINDS[extension] = kind;
}
register("image", "png jpg jpeg gif webp bmp svg ico heic heif avif tif tiff");
register("video", "mp4 m4v mov mkv webm avi wmv flv 3gp mpg mpeg");
register("audio", "mp3 wav flac aac ogg oga m4a opus wma");
register("pdf", "pdf");
register("doc", "doc docx odt rtf pages wps");
register("sheet", "xls xlsx ods csv tsv numbers et");
register("slides", "ppt pptx odp key dps");
register("archive", "zip rar 7z tar gz tgz bz2 tbz2 xz txz zst iso dmg deb rpm jar war apk");
register(
  "code",
  "js jsx ts tsx mjs cjs py rb go rs java kt c cc cpp h hpp cs php sh bash zsh fish ps1 bat cmd sql html htm css scss sass less vue svelte json jsonl yaml yml toml xml ini conf cfg env lua pl r swift dart tf hcl",
);
register("text", "txt md markdown mdx log rst nfo text");

/** Lower-case extension without the dot; "" for none or a leading-dot name. */
export function getFileExtension(name: string | null | undefined): string {
  const base = (name ?? "").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * MIME first, then the extension: SFTP and WebDAV listings often report
 * `application/octet-stream` (or nothing), and the name is all there is.
 */
export function getFileKind(entry: {
  entryType?: string | null;
  mimeType?: string | null;
  name?: string | null;
}): FileKind {
  if (entry.entryType === "DIRECTORY" || entry.mimeType === "inode/directory") return "folder";
  const mime = (entry.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword" || mime.includes("opendocument.text")) return "doc";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel" || mime.includes("opendocument.spreadsheet") || mime === "text/csv" || mime === "text/tab-separated-values") return "sheet";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint" || mime.includes("opendocument.presentation")) return "slides";
  const byExtension = EXTENSION_KINDS[getFileExtension(entry.name)];
  if (byExtension) return byExtension;
  if (/(zip|x-tar|gzip|x-7z|x-rar|x-bzip|x-xz|java-archive)/.test(mime)) return "archive";
  if (/(json|javascript|typescript|xml|yaml|x-sh|x-python|sql)/.test(mime)) return "code";
  if (mime.startsWith("text/")) return "text";
  return "file";
}

/** Chart hues: the palette validated for fills in both themes. */
const KIND_HUE: Record<FileKind, string> = {
  folder: "var(--chart-3)",
  image: "var(--chart-5)",
  video: "var(--chart-6)",
  audio: "var(--chart-1)",
  pdf: "var(--chart-6)",
  doc: "var(--chart-4)",
  sheet: "var(--chart-2)",
  slides: "var(--chart-3)",
  archive: "var(--chart-3)",
  code: "var(--chart-4)",
  text: "var(--text-muted)",
  file: "var(--text-muted)",
};

/** Kinds whose large icon carries the extension as a badge. */
const LABELLED_KINDS = new Set<FileKind>(["pdf", "doc", "sheet", "slides", "archive", "code", "text"]);

function badgeLabel(kind: FileKind, extension: string) {
  if (kind === "pdf") return "PDF";
  const label = extension.toUpperCase();
  return label.length > 4 ? label.slice(0, 4) : label;
}

function KindGlyph({ kind }: { kind: FileKind }) {
  const stroke = { stroke: "var(--file-hue)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
  switch (kind) {
    case "image":
      return (
        <>
          <circle cx="16" cy="19" r="2.2" fill="var(--file-hue)" />
          <path d="M11 30l6.2-6.5 3.8 3.8 3-3 5 5.7z" fill="var(--file-hue)" />
        </>
      );
    case "video":
      return <path d="M17 18.5v11l9-5.5z" fill="var(--file-hue)" />;
    case "audio":
      return (
        <>
          <path d="M23 17.5v9" {...stroke} />
          <path d="M23 17.5l-6 1.6v9" {...stroke} />
          <circle cx="15.2" cy="28.4" r="2.2" fill="var(--file-hue)" />
          <circle cx="21.2" cy="26.8" r="2.2" fill="var(--file-hue)" />
        </>
      );
    case "archive":
      return (
        <>
          <path d="M19 15h2M21 18h2M19 21h2M21 24h2" {...stroke} />
          <rect x="18" y="26" width="5" height="5" rx="1.2" fill="var(--file-hue)" />
        </>
      );
    case "code":
      return <path d="M16 20l-3.5 4 3.5 4M24 20l3.5 4-3.5 4M21.5 18.5l-3 11" {...stroke} />;
    case "sheet":
      return (
        <>
          <rect x="12" y="18" width="16" height="12" rx="1.5" {...stroke} strokeWidth={1.8} />
          <path d="M12 22h16M12 26h16M18 18v12" {...stroke} strokeWidth={1.6} />
        </>
      );
    case "slides":
      return (
        <>
          <rect x="12" y="18" width="16" height="10" rx="1.5" {...stroke} strokeWidth={1.8} />
          <path d="M20 28v3M16 31h8" {...stroke} strokeWidth={1.6} />
        </>
      );
    case "pdf":
    case "doc":
    case "text":
      return <path d="M13 19h14M13 23h14M13 27h9" {...stroke} />;
    default:
      return null;
  }
}

/**
 * Drive-style type icon: a folder, or a page tinted by kind. At 32px and
 * above the page carries a glyph and, for documents, its extension badge.
 */
export function FileTypeIcon({
  entry,
  size = 40,
  className,
}: {
  entry: Pick<StorageEntry, "entryType" | "mimeType"> & { name?: string | null };
  size?: number;
  className?: string;
}) {
  const kind = getFileKind(entry);
  const style = { "--file-hue": KIND_HUE[kind] } as CSSProperties;
  if (kind === "folder") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={className} style={style} data-file-kind="folder">
        <path d="M4 11a3 3 0 0 1 3-3h8.4a3 3 0 0 1 2.2 1L20 11.5h13a3 3 0 0 1 3 3V15H4z" fill="var(--file-hue)" opacity="0.55" />
        <path d="M4 15.5h32V30a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="var(--file-hue)" opacity="0.92" />
      </svg>
    );
  }
  const extension = getFileExtension(entry.name);
  const showBadge = size >= 32 && LABELLED_KINDS.has(kind) && (kind === "pdf" || Boolean(extension));
  const label = showBadge ? badgeLabel(kind, extension) : "";
  const badgeWidth = Math.max(13, label.length * 5.4 + 5);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={className} style={style} data-file-kind={kind}>
      <path
        d="M11 4h13.2L33 12.8V33a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
        fill="color-mix(in srgb, var(--file-hue) 14%, var(--surface))"
        stroke="color-mix(in srgb, var(--file-hue) 60%, transparent)"
        strokeWidth="1.4"
      />
      <path d="M24 4.4V10a3 3 0 0 0 3 3h5.6" fill="none" stroke="color-mix(in srgb, var(--file-hue) 60%, transparent)" strokeWidth="1.4" strokeLinejoin="round" />
      {showBadge ? (
        <>
          <rect x="4.5" y="22" width={badgeWidth} height="11" rx="2.5" fill="var(--file-hue)" />
          <text
            x={4.5 + badgeWidth / 2}
            y="30"
            textAnchor="middle"
            fontSize="7.4"
            fontWeight="700"
            fontFamily="var(--app-font-sans)"
            fill="var(--surface)"
          >
            {label}
          </text>
        </>
      ) : (
        <KindGlyph kind={kind} />
      )}
    </svg>
  );
}
