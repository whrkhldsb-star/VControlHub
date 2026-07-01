"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

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
	get: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
	post: "border-cyan-400/25 bg-cyan-400/10 text-[var(--text-secondary)]",
	put: "border-amber-400/25 bg-amber-400/10 text-amber-200",
	patch: "border-violet-400/25 bg-violet-400/10 text-violet-200",
	delete: "border-rose-400/25 bg-rose-400/10 text-rose-200",
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
	}, [t]);

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
	const tagDescriptions = useMemo(() => new Map((spec?.tags ?? []).map((tag) => [tag.name, tag.description ?? ""])), [spec]);

	return (
		<div className="min-h-screen bg-[var(--background)] px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8">
			<div className="mx-auto max-w-7xl space-y-6">
				<header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<p data-page-eyebrow className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">OpenAPI</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{t("apiDocsPage.title")}</h1>
						<p className="mt-1.5 max-w-2xl text-sm text-[var(--text-muted)]">
							{spec?.info?.description ?? t("apiDocsPage.description")}
						</p>
					</div>
					<a
						href="/api/docs/openapi.json"
						target="_blank"
						rel="noreferrer"
						data-tone="cyan" className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-400/25 px-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-cyan-400/15"
					>
						OpenAPI JSON
					</a>
				</header>

				<section className="rounded-2xl border border-[var(--border)]/[0.06] bg-[var(--surface)]/[0.02] p-4 shadow-lg">
					<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
						<label className="block">
							<span className="sr-only">{t("apiDocsPage.searchAria")}</span>
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={t("apiDocsPage.searchPlaceholder")}
								className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
							/>
						</label>
						<div className="text-sm text-[var(--text-muted)]">
							{spec
								? t("apiDocsPage.summaryCount")
									.replace("{count}", String(filtered.length))
									.replace("{total}", String(entries.length))
								: t("apiDocsPage.loadingInline")}
						</div>
					</div>
				</section>

				{error ? (
					<div role="alert" data-tone="rose" className="rounded-2xl border border-rose-400/20 p-4 text-sm text-rose-200">
						{error}
					</div>
				) : null}

				{!spec && !error ? (
					<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-8 text-sm text-[var(--text-muted)]">{t("apiDocsPage.loading")}</div>
				) : null}

				{grouped.map(([tag, tagEntries]) => (
					<section key={tag} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
							<div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<h2 className="text-base font-semibold text-[var(--text-primary)]">{tag}</h2>
										{tagDescriptions.get(tag) ? <p className="mt-1 text-xs text-[var(--text-muted)]">{tagDescriptions.get(tag)}</p> : null}
									</div>
									<span className="rounded-full border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--text-muted)]">{t("apiDocsPage.tagCount").replace("{count}", String(tagEntries.length))}</span>
							</div>
						</div>
						<div className="divide-y divide-[var(--border)]">
							{tagEntries.map((entry) => (
								<article key={`${entry.method}-${entry.path}`} className="px-4 py-4 sm:px-5">
									<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className={`rounded-lg border px-2 py-1 font-mono text-xs font-semibold uppercase ${methodStyles[entry.method] ?? "border-slate-400/25 bg-slate-400/10 text-[var(--text-primary)]"}`}>
													{entry.method}
												</span>
												<code className="break-all rounded-lg bg-[var(--surface-subtle)] px-2 py-1 font-mono text-sm text-[var(--color-action)]">/api{entry.path}</code>
												</div>
												<h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">{entry.operation.summary ?? t("apiDocsPage.tag.untagged")}</h3>
												{entry.operation.description ? <p className="mt-1 text-sm text-[var(--text-muted)]">{entry.operation.description}</p> : null}
												</div>
												<div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)] lg:justify-end">
												{entry.operation.parameters?.length ? <span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">{t("apiDocsPage.paramCount").replace("{count}", String(entry.operation.parameters.length))}</span> : null}
												{entry.operation.requestBody ? <span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">{t("apiDocsPage.label.requestBody")}</span> : null}
												{entry.operation.responses ? <span className="rounded-full bg-[var(--surface-hover)] px-2 py-1">{t("apiDocsPage.label.responses")} {Object.keys(entry.operation.responses).join("/")}</span> : null}
										</div>
									</div>
								</article>
							))}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
