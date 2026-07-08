import { requireSession } from "@/lib/auth/require-session";
import { OFFICE_MIME_TYPES, ARCHIVE_MIME_TYPES, CSV_MIME_TYPES, MARKDOWN_MIME_TYPES, EXTENDED_TEXT_MIME_TYPES } from "@/lib/storage/mime-constants";
import { PageShell } from "@/components/page-shell";
import { File as FileIcon } from "@/components/icons";
import { MediaPreviewClient } from "./media-preview-client";
import { TextPreviewClient } from "./text-preview-client";
import { MarkdownPreviewClient } from "./markdown-preview-client";
import { CsvPreviewClient } from "./csv-preview-client";
import { OfficePreviewClient } from "./office-preview-client";
import { ArchivePreviewClient } from "./archive-preview-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

type PreviewPageProps = {
	searchParams?: Promise<{
		href?: string;
		name?: string;
		type?: string;
		driver?: string;
		size?: string;
		nodeId?: string;
		relativePath?: string;
		fileEntryId?: string;
		editable?: string;
		serverId?: string;
		reloadUnit?: string;
		reloadKind?: string;
	}>;
};

/* Fallback: detect type by file extension when MIME is generic/unknown */
function detectByExtension(name: string): { isMarkdown: boolean; isCsv: boolean; isText: boolean } {
	const ext = name.toLowerCase().split(".").pop() ?? "";
	const mdExts = ["md", "mdx", "markdown", "mkd"];
	const csvExts = ["csv", "tsv", "tab"];
	const textExts = [
		"txt", "log", "json", "jsonl", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf",
		"js", "jsx", "ts", "tsx", "mjs", "cjs",
		"py", "pyw", "rb", "rs", "go", "java", "kt", "c", "cpp", "h", "hpp",
		"sh", "bash", "zsh", "fish",
		"html", "htm", "xml", "xsl", "xslt", "css", "scss", "sass", "less",
		"sql", "php", "lua", "r", "pl", "ps1", "bat", "cmd",
		"env", "gitignore", "dockerignore", "editorconfig", "prettierrc", "eslintrc",
		"tf", "hcl", "nix", "dhall",
		"svg", "svelte", "vue",
	];
	return {
		isMarkdown: mdExts.includes(ext),
		isCsv: csvExts.includes(ext),
		isText: textExts.includes(ext),
	};
}

function isAllowedPreviewHref(href: string): boolean {
	if (!href || !href.startsWith("/") || href.startsWith("//")) return false;
	return [
		"/api/files/",
		"/api/storage/",
		"/api/media/",
		"/api/images/",
		"/api/share/",
	].some((prefix) => href.startsWith(prefix));
}

export default async function FilePreviewPage({ searchParams }: PreviewPageProps) {
	await requireSession();
	const locale = await getServerLocale();

	const params = await searchParams;
	const requestedHref = params?.href ?? "";
	const href = isAllowedPreviewHref(requestedHref) ? requestedHref : "";
	const invalidHref = Boolean(requestedHref && !href);
	const name = params?.name ?? t("textPreview.preview.unknownFile", locale);
	const mimeType = params?.type ?? "";
	const driver = params?.driver ?? "LOCAL";
	const size = params?.size ? Number(params.size) : 0;
	const nodeId = params?.nodeId ?? "";
	const relativePath = params?.relativePath ?? "";
	const fileEntryId = params?.fileEntryId ?? "";
	const editable = params?.editable === "1";
	const serverId = params?.serverId ?? "";
	const reloadUnit = params?.reloadUnit ?? "";
	const reloadKind: "systemd" | "compose" | undefined =
		params?.reloadKind === "compose"
			? "compose"
			: params?.reloadKind === "systemd"
				? "systemd"
				: undefined;

	const downloadUrl = href ? `${href}${href.includes("?") ? "&" : "?"}download=1` : "";

	const isImage = mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
	const isSvg = mimeType === "image/svg+xml";
	const isVideo = mimeType.startsWith("video/");
	const isAudio = mimeType.startsWith("audio/");
	const isPdf = mimeType === "application/pdf";

	// Primary MIME detection
	const isMarkdown = MARKDOWN_MIME_TYPES.includes(mimeType) || (mimeType.startsWith("text/") && mimeType !== "text/csv" && (name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".mdx") || name.toLowerCase().endsWith(".markdown")));
	const isCsv = CSV_MIME_TYPES.includes(mimeType);
	const isText =
		mimeType.startsWith("text/") ||
		EXTENDED_TEXT_MIME_TYPES.includes(mimeType);
	const isOffice = OFFICE_MIME_TYPES.includes(mimeType);
	const isArchive = ARCHIVE_MIME_TYPES.includes(mimeType);

	// Extension fallback when MIME is empty or generic
	const ext = detectByExtension(name);
	const resolvedIsMarkdown = isMarkdown || (!mimeType && ext.isMarkdown);
	const resolvedIsCsv = isCsv || (!mimeType && ext.isCsv) || (mimeType === "text/plain" && ext.isCsv);
	const resolvedIsText = isText || ext.isText || isSvg;

	const largeTextWarning = (resolvedIsText || resolvedIsMarkdown) && size > 512 * 1024;

	return (
		<PageShell maxW="max-w-6xl">
				{/* Header */}
				<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<a
							href="/files"
							className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--color-action-border)]/50 hover:bg-[var(--surface)]/10"
						>
							{t("textPreview.preview.backToFiles", locale)}
						</a>
						<h1 className="truncate text-xl font-semibold text-[var(--text-primary)]">{name}</h1>
						<span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">
							{driver}
						</span>
					</div>
					{downloadUrl ? (
						<a
							href={downloadUrl}
							data-tone="accent"
							className="rounded-lg border px-4 py-2 text-sm"
						>
							{t("textPreview.preview.download", locale)}
						</a>
					) : null}
			</div>

				{/* Large file warning */}
				{invalidHref ? (
					<div role="alert" data-tone="danger" className="mb-4 rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">
						{t("textPreview.preview.invalidHref", locale)}
					</div>
				) : null}

				{/* Large file warning */}
				{largeTextWarning ? (
					<div data-tone="amber" className="mb-4 rounded-2xl border border-[var(--warning-border)] px-4 py-3 text-sm text-[var(--warning)]">
						{t("textPreview.preview.largeWarning", locale).replace("{size}", (size / 1024 / 1024).toFixed(1))}
					</div>
				) : null}

				{/* Preview content */}
				<div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
					{isImage && href ? (
						<div className="flex items-center justify-center">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={href}
								alt={name}
								className="max-h-[80vh] max-w-full rounded-2xl object-contain"
							/>
						</div>
					) : isVideo || isAudio ? (
						<MediaPreviewClient
							href={href}
							name={name}
							mimeType={mimeType}
							driver={driver}
						/>
					) : isPdf && href ? (
						<iframe
							src={href}
							title={name}
							className="h-[85vh] w-full rounded-2xl border-0"
						/>
					) : resolvedIsMarkdown && href ? (
						<MarkdownPreviewClient href={href} />
					) : resolvedIsCsv && href ? (
						<CsvPreviewClient href={href} />
					) : resolvedIsText && href ? (
							<TextPreviewClient href={href} name={name} fileEntryId={fileEntryId} editable={editable} driver={driver} nodeId={nodeId} relativePath={relativePath} serverId={serverId || undefined} reloadUnit={reloadUnit || undefined} reloadKind={reloadKind} />
					) : isOffice && href ? (
						<OfficePreviewClient href={href} name={name} />
					) : isArchive ? (
						<ArchivePreviewClient
							name={name}
							nodeId={nodeId}
							relativePath={relativePath}
							driver={driver}
						/>
					) : (
						<div className="flex flex-col items-center gap-4 py-16 text-[var(--text-secondary)]">
							<FileIcon size={48} className="text-[var(--text-muted)]" />
							<p>{t("textPreview.preview.unsupported", locale)}</p>
							{downloadUrl ? (
								<a
									href={downloadUrl}
									data-tone="accent"
							className="rounded-lg border px-4 py-2 text-sm"
								>
									{t("textPreview.preview.downloadToView", locale)}
								</a>
							) : null}
						</div>
					)}
				</div>
		</PageShell>
	);
}
