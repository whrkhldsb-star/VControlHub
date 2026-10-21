import { cn } from "@/lib/ui/cn";
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

/** Kinds whose large icon names the extension instead of drawing a glyph. */
const LABELLED_KINDS = new Set<FileKind>(["pdf", "doc", "sheet", "slides", "archive", "code", "text"]);

function badgeLabel(kind: FileKind, extension: string) {
  if (kind === "pdf") return "PDF";
  const label = extension.toUpperCase();
  return label.length > 4 ? label.slice(0, 4) : label;
}

/** The page outline every file icon shares (24-unit grid, like the app's line icons). */
const PAGE = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z";
const PAGE_FOLD = "M14 2v4a2 2 0 0 0 2 2h4";
const FOLDER = "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z";

function KindGlyph({ kind }: { kind: FileKind }) {
  switch (kind) {
    case "image":
      return (
        <>
          <circle cx="10" cy="12.5" r="1.5" />
          <path d="m20 17-2.3-2.3a1.6 1.6 0 0 0-2.3 0L9.5 20.5" />
        </>
      );
    case "video":
      return <path d="M10 11.5v6l5-3z" />;
    case "audio":
      return (
        <>
          <path d="M11 17.5V11l4.5-1v6" />
          <circle cx="9.5" cy="17.5" r="1.5" />
          <circle cx="14" cy="16" r="1.5" />
        </>
      );
    case "archive":
      return <path d="M10 4h1M10 7h1M10 10h1M9.5 13h2v3h-2z" />;
    case "code":
      return <path d="m10 12.5-2 2 2 2M14 16.5l2-2-2-2" />;
    case "sheet":
      return <path d="M8 13h2M14 13h2M8 17h2M14 17h2" />;
    case "slides":
      return <rect x="8" y="12" width="8" height="5.5" rx="1" />;
    case "pdf":
    case "doc":
    case "text":
      return <path d="M10 9H8M16 13H8M16 17H8" />;
    default:
      return null;
  }
}

/**
 * Line icon for an entry, drawn like the app's other icons: folders in the
 * accent colour, files in the secondary text colour with a glyph for their
 * kind. At 40px and above documents name their extension instead.
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
  // About 1.75px at list size, a little heavier when drawn large.
  const strokePx = size <= 24 ? 1.75 : 1.75 + (size - 24) * 0.015;
  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: (strokePx * 24) / size,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    "data-file-kind": kind,
    className: cn("shrink-0", kind === "folder" ? "text-[var(--accent)]" : "text-[var(--text-secondary)]", className),
  };
  if (kind === "folder") {
    return (
      <svg {...svgProps}>
        <path d={FOLDER} />
      </svg>
    );
  }
  const extension = getFileExtension(entry.name);
  const label = size >= 40 && LABELLED_KINDS.has(kind) && (kind === "pdf" || Boolean(extension)) ? badgeLabel(kind, extension) : "";
  return (
    <svg {...svgProps}>
      <path d={PAGE} />
      <path d={PAGE_FOLD} />
      {label ? (
        <text x="12" y="16.6" textAnchor="middle" fontSize={label.length > 3 ? 4 : 4.6} fontWeight="700" fontFamily="var(--app-font-sans)" fill="currentColor" stroke="none">
          {label}
        </text>
      ) : (
        <KindGlyph kind={kind} />
      )}
    </svg>
  );
}
