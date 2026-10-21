"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { FolderOpen, RefreshCw } from "@/components/icons";
import { InlineLoading, Notice } from "@/components/ui-primitives";
import { FileTypeIcon } from "../file-entry-icons";
import { buildSearchHref } from "../file-entry-utils";

type ArchiveEntry = {
	name: string;
	size: number;
	isDirectory: boolean;
	modified?: string;
};

/** Formats /api/files/extract can unpack on a LOCAL node; 7z and rar can only be listed. */
const EXTRACTABLE = /\.(zip|jar|tar|tgz|tar\.gz|gz)$/i;

export function ArchivePreviewClient({
	name,
	nodeId,
	relativePath,
	driver,
}: {
	name: string;
	nodeId: string;
	relativePath: string;
	driver: string;
}) {
	const { t } = useI18n();
	const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// The listing loads as soon as the archive opens.
	const [loading, setLoading] = useState(true);
	const [extracting, startExtractTransition] = useTransition();
	const [extractResult, setExtractResult] = useState<{ tone: "ok" | "error"; text: string; folder?: string } | null>(null);
	const requestRef = useRef(0);

	const requestContents = useCallback(() => {
		const params = new URLSearchParams({ nodeId, relativePath, driver, name });
		return csrfFetch(`/api/files/archive-list?${params.toString()}`) as Promise<{ entries?: ArchiveEntry[] }>;
	}, [driver, name, nodeId, relativePath]);

	/** Applies a listing request's outcome unless a newer request started meanwhile. */
	const settle = useCallback((requestId: number, request: Promise<{ entries?: ArchiveEntry[] }>) => {
		request.then(
			(data) => {
				if (requestId !== requestRef.current) return;
				setEntries(data.entries ?? []);
				setError(null);
				setLoading(false);
			},
			(err: unknown) => {
				if (requestId !== requestRef.current) return;
				setError(getErrorMessage(err, t("archivePreview.unknownError")));
				setLoading(false);
			},
		);
	}, [t]);

	useEffect(() => {
		settle(++requestRef.current, requestContents());
	}, [requestContents, settle]);

	function loadArchiveContents() {
		setLoading(true);
		setError(null);
		settle(++requestRef.current, requestContents());
	}

	function handleExtract() {
		startExtractTransition(async () => {
			setExtractResult(null);
			try {
				const data = await csrfFetch("/api/files/extract", {
					method:"POST",
					headers: {"Content-Type":"application/json" },
					body: JSON.stringify({ nodeId, relativePath, driver, name }),
				});
				if (data.error) throw new Error(data.error);
				setExtractResult({ tone: "ok", text: data.message || t("archivePreview.extractDone"), folder: typeof data.folder === "string" ? data.folder : undefined });
			} catch (err) {
				setExtractResult({
					tone: "error",
					text: getErrorMessage(err, t("archivePreview.extractFailed")),
				});
			}
		});
	}

	const canExtract = driver === "LOCAL" && EXTRACTABLE.test(name) && Boolean(entries?.length);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				{canExtract ? (
					<ActionButton variant="primary" icon={<FolderOpen aria-hidden />} onClick={handleExtract} loading={extracting} disabled={extracting}>
						{extracting ? t("archivePreview.extracting") : t("archivePreview.extract")}
					</ActionButton>
				) : null}
				<ActionButton variant="secondary" icon={<RefreshCw aria-hidden />} onClick={loadArchiveContents} disabled={loading}>
					{loading ? t("archivePreview.loading") : t("archivePreview.refreshList")}
				</ActionButton>
				{canExtract ? <span className="text-xs text-[var(--text-muted)]">{t("archivePreview.extractHint")}</span> : null}
			</div>

			{error ? <Notice tone="danger">{error}</Notice> : null}

			{extractResult ? (
				<Notice tone={extractResult.tone === "ok" ? "success" : "danger"}>
					<span className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<span>{extractResult.text}</span>
						{extractResult.folder ? (
							<ButtonLink size="sm" variant="secondary" href={buildSearchHref(extractResult.folder, { nodeId })}>
								{t("archivePreview.openFolder")}
							</ButtonLink>
						) : null}
					</span>
				</Notice>
			) : null}

			{loading && !entries ? <InlineLoading label={t("archivePreview.loading")} /> : null}

			{entries && entries.length > 0 ? (
				<div data-inset="" className="overflow-hidden">
					<div className="max-h-[60vh] overflow-auto">
						<table>
							<thead>
								<tr>
									<th scope="col">{t("archivePreview.table.name")}</th>
									<th scope="col" className="w-28 text-right">{t("archivePreview.table.size")}</th>
								</tr>
							</thead>
							<tbody>
								{entries.map((entry, index) => (
									<tr key={`${entry.name}-${index}`}>
										<td className="max-w-0">
											<span className="flex min-w-0 items-center gap-2.5">
												<FileTypeIcon entry={{ entryType: entry.isDirectory ? "DIRECTORY" : "FILE", mimeType: null, name: entry.name }} size={18} />
												<span className="truncate text-[var(--text-primary)]" title={entry.name}>{entry.name}</span>
											</span>
										</td>
										<td className="text-right text-xs tabular-nums text-[var(--text-secondary)]">
											{entry.isDirectory ? t("archivePreview.entryType.directory") : formatBytesShared(entry.size, { zero: "-" })}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="border-t border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-muted)]">
						{t("archivePreview.totalItems", { count: entries.length })}
					</div>
				</div>
			) : entries && entries.length === 0 ? (
				<div className="text-sm text-[var(--text-secondary)]">{t("archivePreview.empty")}</div>
			) : null}
		</div>
	);
}
