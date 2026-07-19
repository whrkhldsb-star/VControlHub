"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { formatBytes } from "@/lib/format/bytes";
import { RestoreButton } from "./restore-button";
import { PermanentDeleteButton } from "./permanent-delete-button";

export type DeletedEntryProp = {
	id: string;
	name: string;
	entryType: string;
	relativePath: string;
	size: number | bigint | null;
};

function formatFileSize(bytes: number | bigint | null | undefined): string {
	return formatBytes(typeof bytes ==="bigint" ? Number(bytes) : bytes);
}

function entryTypeLabel(t: (key: string) => string, entryType: string): string {
	return entryType ==="DIRECTORY"
		? t("recycleBinSection.entryType.directory")
		: t("recycleBinSection.entryType.file");
}

export function RecycleBinSectionClient({
	deletedEntries,
	canDelete,
	onRefresh,
}: {
	deletedEntries: DeletedEntryProp[];
	canDelete: boolean;
	onRefresh?: () => void;
}) {
	const { t } = useI18n();

	if (deletedEntries.length === 0) {
		return (
			<article className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
				<h3 className="text-xl font-semibold text-[var(--text-primary)]">{t("recycleBinSection.title")}</h3>
				<p className="mt-4 text-sm text-[var(--text-muted)]">{t("recycleBinSection.empty")}</p>
			</article>
		);
	}

	return (
		<article className="rounded-3xl border border-[var(--danger-border)] bg-[var(--surface)] p-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-xl font-semibold text-[var(--text-primary)]">{t("recycleBinSection.title")}</h3>
					<p className="mt-2 text-sm text-[var(--text-secondary)]">
						{t("recycleBinSection.summary").replace("{count}", String(deletedEntries.length))}
					</p>
				</div>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
				<div className="min-w-[860px]">
					{/* Desktop table view (md+) */}
					<div className="hidden md:block">
						<div className="grid grid-cols-[minmax(260px,2fr)_120px_120px_minmax(220px,1fr)_200px] bg-[var(--surface-subtle)] px-4 py-3 text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
							<div>{t("recycleBinSection.table.name")}</div>
							<div>{t("recycleBinSection.table.type")}</div>
							<div>{t("recycleBinSection.table.size")}</div>
							<div>{t("recycleBinSection.table.path")}</div>
							<div>{t("recycleBinSection.table.actions")}</div>
						</div>

						<div className="divide-y divide-[var(--border)] bg-[var(--surface-subtle)]">
							{deletedEntries.map((entry) => (
								<div
									key={entry.id}
									className="grid grid-cols-[minmax(260px,2fr)_120px_120px_minmax(220px,1fr)_200px] items-center gap-4 px-4 py-3 text-sm"
								>
									<div className="min-w-0 truncate font-medium text-[var(--text-primary)]">{entry.name}</div>
									<div className="text-[var(--text-secondary)]">{entryTypeLabel(t, entry.entryType)}</div>
									<div className="text-[var(--text-secondary)]">{formatFileSize(entry.size)}</div>
									<div className="min-w-0 truncate text-xs text-[var(--text-muted)]">{entry.relativePath}</div>
									<div className="flex flex-wrap gap-2">
										{canDelete ? (
											<>
												<RestoreButton fileEntryId={entry.id} onRefresh={onRefresh} />
												<PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
											</>
										) : (
											<span className="text-xs text-[var(--text-muted)]">{t("recycleBinSection.noPermission")}</span>
										)}
									</div>
								</div>
							))}
						</div>
					</div>

					{/* Mobile card view (below md) */}
					<div className="md:hidden divide-y divide-[var(--border)] bg-[var(--surface-subtle)]">
						{deletedEntries.map((entry) => (
							<div key={entry.id} className="px-4 py-3">
								<div className="min-w-0">
									<div className="truncate font-medium text-[var(--text-primary)]">{entry.name}</div>
									<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{entry.relativePath}</p>
								</div>
								<div className="mt-1.5 flex gap-3 text-xs text-[var(--text-muted)]">
									<span>{entryTypeLabel(t, entry.entryType)}</span>
									<span>{formatFileSize(entry.size)}</span>
								</div>
								{canDelete ? (
									<div className="mt-2 flex flex-wrap gap-2">
										<RestoreButton fileEntryId={entry.id} onRefresh={onRefresh} />
										<PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
									</div>
								) : (
									<span className="mt-2 inline-block text-xs text-[var(--text-muted)]">{t("recycleBinSection.noPermission")}</span>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
		</article>
	);
}
