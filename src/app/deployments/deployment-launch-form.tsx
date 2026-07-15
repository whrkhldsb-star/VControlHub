"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type DeploymentTemplateOption = {
	id: string;
	name: string;
	description?: string | null;
	command: string;
	variables?: string[];
};

type DeploymentServerOption = {
	id: string;
	name: string;
	host: string;
	username: string;
};

function uniqueVariables(template?: DeploymentTemplateOption) {
	if (!template) return [];
	const explicit = Array.isArray(template.variables) ? template.variables : [];
	const fromCommand = Array.from(template.command.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)).map((match) => match[1]!);
	return Array.from(new Set([...explicit, ...fromCommand])).filter(Boolean);
}

function previewCommand(template: DeploymentTemplateOption | undefined, variables: string[], t: (k: string) => string) {
	if (!template) return t("deploymentsPage.launch.noTemplate");
	return variables.reduce((command, name) => command.replaceAll(`{{${name}}}`, `<${name}>`), template.command);
}

export function DeploymentLaunchForm({ templates, servers }: { templates: DeploymentTemplateOption[]; servers: DeploymentServerOption[] }) {
	const { t } = useI18n();
	const router = useRouter();
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
	const variables = useMemo(() => uniqueVariables(selectedTemplate), [selectedTemplate]);

	if (templates.length === 0) {
		return (
			<div data-tone="amber" className="mt-4 rounded-xl border border-[var(--warning-border)] px-4 py-3 text-sm text-[var(--warning)]">
				{t("deploymentsPage.launch.noTemplateHint")}
			</div>
		);
	}

	if (servers.length === 0) {
		return (
			<div data-tone="amber" className="mt-4 rounded-xl border border-[var(--warning-border)] px-4 py-3 text-sm text-[var(--warning)]">
				<p className="font-medium">{t("deploymentsPage.launch.noVpsTitle")}</p>
				<p className="mt-1 text-xs text-[var(--warning)]/80">{t("deploymentsPage.launch.noVpsDesc")}</p>
				<Link href="/servers" className="mt-3 inline-flex rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)] transition hover:bg-[var(--warning-bg)]">{t("deploymentsPage.launch.addVps")}</Link>
			</div>
		);
	}

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setPending(true);
		try {
			const form = e.currentTarget;
			const fd = new FormData(form);
			const vars: Record<string, string> = {};
			for (const name of variables) {
				const val = String(fd.get(`variables.${name}`) || "").trim();
				vars[name] = val;
			}
			const serverIds = fd.getAll("serverIds").map(String).filter(Boolean);
			if (serverIds.length === 0) {
				setError(t("deploymentsPage.launch.noServerSelected"));
				setPending(false);
				return;
			}
			const reason = String(fd.get("reason") || "").trim();
			await csrfFetch("/api/deployments", {
				method: "POST",
				body: JSON.stringify({
					templateId: fd.get("templateId"),
					serverIds,
					variables: vars,
					reason: reason || undefined,
				}),
			});
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("deploymentsPage.launch.errorFallback"));
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="mt-4 grid gap-4">
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("deploymentsPage.launch.templateLabel")}
					<select
						name="templateId"
						value={templateId}
						onChange={(event) => setTemplateId(event.target.value)}
						className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
					>
						{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
					</select>
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("deploymentsPage.launch.reasonLabel")}
					<input name="reason" maxLength={500} placeholder={t("deploymentsPage.launch.reasonPlaceholder")} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
				</label>
			</div>

			{selectedTemplate?.description && <p className="text-xs text-[var(--text-muted)]">{selectedTemplate.description}</p>}

			{variables.length > 0 ? (
				<div data-tone="cyan" className="rounded-xl border border-[var(--color-action-border)]/20 p-4 light:border-[var(--color-action-border)] light:bg-[var(--color-action-bg)]">
					<div className="mb-3 flex items-center justify-between gap-3">
						<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("deploymentsPage.launch.variablesTitle")}</h3>
						<span className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.variablesHint")}</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						{variables.map((name) => (
							<label key={name} className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
								{name}
								<input name={`variables.${name}`} required placeholder={t("deploymentsPage.launch.variablePlaceholder").replace("{name}", name)} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
							</label>
						))}
					</div>
				</div>
			) : (
				<p className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.noVariables")}</p>
			)}

			<div>
				<div className="mb-2 flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("deploymentsPage.launch.targetVpsTitle")}</h3>
					<span className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.targetVpsHint")}</span>
				</div>
				<div className="grid gap-2 md:grid-cols-2">
					{servers.map((server) => (
						<label key={server.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
							<input type="checkbox" name="serverIds" value={server.id} />
							<span>{server.name} · {server.username}@{server.host}</span>
						</label>
					))}
				</div>
			</div>

			<details className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
				<summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">{t("deploymentsPage.launch.previewCommand")}</summary>
				<code className="mt-3 block max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)]/70 p-3 font-mono text-xs text-[var(--text-secondary)]">{previewCommand(selectedTemplate, variables, t)}</code>
			</details>

			{error && <p className="text-xs text-[var(--danger)]">{error}</p>}
			<button disabled={pending} className="w-fit rounded-lg bg-[var(--color-action-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:cursor-not-allowed disabled:opacity-60">{pending ? t("deploymentsPage.launch.submitting") : t("deploymentsPage.launch.submit")}</button>
		</form>
	);
}
