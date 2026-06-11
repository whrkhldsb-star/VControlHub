"use client";

import { useEffect, useMemo, useState } from "react";

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
	post: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
	put: "border-amber-400/25 bg-amber-400/10 text-amber-200",
	patch: "border-violet-400/25 bg-violet-400/10 text-violet-200",
	delete: "border-rose-400/25 bg-rose-400/10 text-rose-200",
};

function groupEntries(spec: OpenApiSpec | null) {
	const entries: ApiEntry[] = [];
	for (const [apiPath, methods] of Object.entries(spec?.paths ?? {})) {
		for (const [method, operation] of Object.entries(methods)) {
			if (!operation || typeof operation !== "object") continue;
			entries.push({
				path: apiPath,
				method,
				tag: operation.tags?.[0] ?? "其他",
				operation,
			});
		}
	}
	return entries;
}

export default function ApiDocsPage() {
	const [spec, setSpec] = useState<OpenApiSpec | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		let cancelled = false;
		fetch("/api/docs/openapi.json", { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(`OpenAPI 加载失败 (${response.status})`);
				return response.json() as Promise<OpenApiSpec>;
			})
			.then((data) => {
				if (!cancelled) setSpec(data);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : "OpenAPI 加载失败");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const entries = useMemo(() => groupEntries(spec), [spec]);
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
						<p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">OpenAPI</p>
						<h1 className="mt-2 text-2xl font-semibold text-white">API 文档</h1>
						<p className="mt-2 max-w-2xl text-sm text-slate-400">
							{spec?.info?.description ?? "VControlHub RESTful API 参考文档。"}
						</p>
					</div>
					<a
						href="/api/docs/openapi.json"
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15"
					>
						OpenAPI JSON
					</a>
				</header>

				<section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 shadow-lg">
					<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
						<label className="block">
							<span className="sr-only">搜索接口</span>
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="搜索路径、方法、模块或说明"
								className="h-10 w-full rounded-lg border border-white/[0.08] bg-slate-950/40 light:bg-white/40 px-3 text-sm text-white placeholder:text-slate-500 light:placeholder:text-slate-400"
							/>
						</label>
						<div className="text-sm text-slate-400">
							{spec ? `${filtered.length}/${entries.length} 个接口` : "正在加载接口定义..."}
						</div>
					</div>
				</section>

				{error ? (
					<div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
						{error}
					</div>
				) : null}

				{!spec && !error ? (
					<div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-sm text-slate-400">正在加载 API 文档...</div>
				) : null}

				{grouped.map(([tag, tagEntries]) => (
					<section key={tag} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
						<div className="border-b border-white/[0.06] px-4 py-3 sm:px-5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h2 className="text-base font-semibold text-white">{tag}</h2>
									{tagDescriptions.get(tag) ? <p className="mt-1 text-xs text-slate-500">{tagDescriptions.get(tag)}</p> : null}
								</div>
								<span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-slate-400">{tagEntries.length} 个接口</span>
							</div>
						</div>
						<div className="divide-y divide-white/[0.06]">
							{tagEntries.map((entry) => (
								<article key={`${entry.method}-${entry.path}`} className="px-4 py-4 sm:px-5">
									<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold uppercase ${methodStyles[entry.method] ?? "border-slate-400/25 bg-slate-400/10 text-slate-200"}`}>
													{entry.method}
												</span>
												<code className="break-all rounded-md bg-slate-950/60 light:bg-white/60 px-2 py-1 font-mono text-sm text-cyan-100">/api{entry.path}</code>
											</div>
											<h3 className="mt-3 text-sm font-medium text-white">{entry.operation.summary ?? "未命名接口"}</h3>
											{entry.operation.description ? <p className="mt-1 text-sm text-slate-400">{entry.operation.description}</p> : null}
										</div>
										<div className="flex flex-wrap gap-2 text-xs text-slate-500 lg:justify-end">
											{entry.operation.parameters?.length ? <span className="rounded-full bg-white/[0.04] px-2 py-1">参数 {entry.operation.parameters.length}</span> : null}
											{entry.operation.requestBody ? <span className="rounded-full bg-white/[0.04] px-2 py-1">请求体</span> : null}
											{entry.operation.responses ? <span className="rounded-full bg-white/[0.04] px-2 py-1">响应 {Object.keys(entry.operation.responses).join("/")}</span> : null}
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
