"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { PageShell, PageHeader, Toolbar } from "@/components/page-shell";

type OpenApiOperation = {
	tags?: string[];
	summary?: string;
	description?: string;
	parameters?: Array<{ name?: string; in?: string; description?: string; required?: boolean }>;
	requestBody?: unknown;
	responses?: Record<string, { description?: string }>;
};

type OpenApiSpec = {
	info?: { title?: string; description?: string; version?: string };
	tags?: Array<{ name: string; description?: string }>;
	paths?: Record<string, Record<string, OpenApiOperation>>;
};

type ApiEntry = {
	path: string;
	method: string;
	tag: string;
	operation: OpenApiOperation;
};

const methodStyles: Record<string, string> = {
	get: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	post: "border-[var(--color-action-border)]/25 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]",
	put: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	patch: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
	delete: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
};

function groupEntries(spec: OpenApiSpec | null, untaggedLabel: string) {
	const entries: ApiEntry[] = [];
	for (const [apiPath, methods] of Object.entries(spec?.paths ?? {})) {
		for (const [method, operation] of Object.entries(methods)) {
			if (!operation || typeof operation !== "object") continue;
			entries.push({
				path: apiPath,
				method,
				tag: operation.tags?.[0] ?? untaggedLabel,
				operation,
			});
		}
	}
	return entries;
}

export default function ApiDocsPage() {
	const { t } = useI18n();
	const [spec, setSpec] = useState<OpenApiSpec | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		let cancelled = false;
		fetch("/api/docs/openapi.json", { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(`${t("apiDocsPage.loadFailed")} (${response.status})`);
				return response.json() as Promise<OpenApiSpec>;
			})
			.then((data) => {
				if (!cancelled) setSpec(data);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : t("apiDocsPage.loadFailed"));
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const entries = useMemo(() => groupEntries(spec, t("apiDocsPage.tag.untagged")), [spec, t]);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return entries;
		return entries.filter((entry) =>
			[entry.path, entry.method, entry.tag, entry.operation.summary, entry.operation.description]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [entries, query]);
	const grouped = useMemo(() => {
		const byTag = new Map<string, ApiEntry[]>();
		for (const entry of filtered) {
			const bucket = byTag.get(entry.tag) ?? [];
			bucket.push(entry);
			byTag.set(entry.tag, bucket);
		}
		return Array.from(byTag.entries());
	}, [filtered]);
	const tagDescriptions = useMemo(
		() => new Map((spec?.tags ?? []).map((tag) => [tag.name, tag.description ?? ""])),
		[spec],
	);

	return (
		<PageShell maxW="max-w-7xl">
			<div className="space-y-6">
				<PageHeader
					eyebrow={t("apiDocsPage.eyebrow")}
					title={t("apiDocsPage.title")}
					description={spec?.info?.description ?? t("apiDocsPage.description")}
				>
					<a
						href="/api/docs/openapi.json"
						target="_blank"
						rel="noreferrer"
						data-secondary
						className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)]"
					>
						{t("apiDocsPage.openApiJsonLink")}
					</a>
				</PageHeader>

				<Toolbar className="w-full">
					<label className="block min-w-0 flex-1">
						<span className="sr-only">{t("apiDocsPage.searchAria")}</span>
						<input
							data-input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("apiDocsPage.searchPlaceholder")}
							className="h-10 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
						/>
					</label>
					<div className="px-2 text-sm text-[var(--text-muted)]">
						{spec
							? t("apiDocsPage.summaryCount")
									.replace("{count}", String(filtered.length))
									.replace("{total}", String(entries.length))
							: t("apiDocsPage.loadingInline")}
					</div>
				</Toolbar>

				{error ? (
					<div role="alert" className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
						{error}
					</div>
				) : null}

				{!spec && !error ? (
					<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-8 text-sm text-[var(--text-muted)]">
						{t("apiDocsPage.loading")}
					</div>
				) : null}

				{grouped.map(([tag, tagEntries]) => (
					<section key={tag} data-card className="overflow-hidden !p-0">
						<div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h2 className="text-base font-semibold text-[var(--text-primary)]">{tag}</h2>
									{tagDescriptions.get(tag) ? (
										<p className="mt-1 text-xs text-[var(--text-muted)]">{tagDescriptions.get(tag)}</p>
									) : null}
								</div>
								<span className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
									{t("apiDocsPage.tagCount").replace("{count}", String(tagEntries.length))}
								</span>
							</div>
						</div>
						<div className="divide-y divide-[var(--border-subtle)]">
							{tagEntries.map((entry) => (
								<article key={`${entry.method}-${entry.path}`} className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none hover:!transform-none">
									<div className="px-4 py-4 sm:px-5">
										<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-2">
													<span
														className={`rounded-lg border px-2 py-1 font-mono text-xs font-semibold uppercase ${
															methodStyles[entry.method] ??
															"border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
														}`}
													>
														{entry.method}
													</span>
													<code className="break-all rounded-lg bg-[var(--surface-subtle)] px-2 py-1 font-mono text-sm text-[var(--color-action)]">
														/api{entry.path}
													</code>
												</div>
												<h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">
													{entry.operation.summary ?? t("apiDocsPage.tag.untagged")}
												</h3>
												{entry.operation.description ? (
													<p className="mt-1 text-sm text-[var(--text-muted)]">{entry.operation.description}</p>
												) : null}
											</div>
											<div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)] lg:justify-end">
												{entry.operation.parameters?.length ? (
													<span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">
														{t("apiDocsPage.paramCount").replace("{count}", String(entry.operation.parameters.length))}
													</span>
												) : null}
												{entry.operation.requestBody ? (
													<span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">
														{t("apiDocsPage.label.requestBody")}
													</span>
												) : null}
												{entry.operation.responses ? (
													<span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">
														{t("apiDocsPage.label.responses")} {Object.keys(entry.operation.responses).join("/")}
													</span>
												) : null}
											</div>
										</div>
									</div>
								</article>
							))}
						</div>
					</section>
				))}
			</div>
		</PageShell>
	);
}
