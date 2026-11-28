"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { UI_INPUT } from "@/lib/ui/classes";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { Disclosure } from "@/components/ui/disclosure";
import { ServerTargetPicker, type ServerTarget } from "@/app/servers/server-target-picker";
import { randomId } from "@/lib/ui/random-id";

type DeploymentTemplateOption = {
	id: string;
	name: string;
	description?: string | null;
	command: string;
	variables?: string[];
};

function uniqueVariables(template?: DeploymentTemplateOption) {
	if (!template) return [];
	const explicit = Array.isArray(template.variables) ? template.variables : [];
	const fromCommand = Array.from(template.command.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)).map((match) => match[1]!);
	return Array.from(new Set([...explicit, ...fromCommand])).filter(Boolean);
}


export function DeploymentLaunchForm({ templates, canCreateCommand }: { templates: DeploymentTemplateOption[]; canCreateCommand?: boolean }) {
	const { t } = useI18n();
	const router = useRouter();
	const { addToast } = useToast();
	const [enabledCount, setEnabledCount] = useState<number | null>(null);
	const [selected, setSelected] = useState<ServerTarget[]>([]);
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [values, setValues] = useState<Record<string, string>>({});
	const [receipt, setReceipt] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lastRequest = useRef<{ body: string; key: string } | null>(null);
	const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
	const variables = useMemo(() => uniqueVariables(selectedTemplate), [selectedTemplate]);

	if (templates.length === 0) {
		return (
			<Notice tone="warning" className="mt-4">
				{t("deploymentsPage.launch.noTemplateHint")}
				<ButtonLink href="/templates" size="sm">{t("deploymentsPage.launch.templatesLink")}</ButtonLink>
				{canCreateCommand && <ButtonLink href="/commands" size="sm">{t("deploymentsPage.oneOff")}</ButtonLink>}
			</Notice>
		);
	}

	if (enabledCount === 0) return (
		<Notice tone="warning" title={t("deploymentsPage.launch.noVpsTitle")} className="mt-4">
			<p>{t("deploymentsPage.launch.noVpsDesc")}</p>
			<ButtonLink href="/servers" size="sm" variant="warning">{t("deploymentsPage.launch.addVps")}</ButtonLink>
		</Notice>
	);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setPending(true);
		try {
			const form = e.currentTarget;
			const fd = new FormData(form);
			const vars: Record<string, string> = {};
			for (const name of variables) {
				const val = String(fd.get(`variables.${name}`) ||"").trim();
				vars[name] = val;
			}
			const serverIds = selected.map(row => row.id);
			if (serverIds.length === 0) {
				setError(t("deploymentsPage.launch.noServerSelected"));
				setPending(false);
				return;
			}
			const reason = String(fd.get("reason") ||"").trim();
			const body = JSON.stringify({
				templateId: fd.get("templateId"),
				serverIds,
				variables: vars,
				reason: reason || undefined,
			});
			if (lastRequest.current?.body !== body) lastRequest.current = { body, key: randomId() };
			const result = await csrfFetch<{ deployment?: { id: string } }>("/api/deployments", {
				method: "POST",
				headers: { "Idempotency-Key": lastRequest.current.key },
				body,
			});
			lastRequest.current = null;
			addToast("success", t("deploymentsPage.launch.toast.success"));
			setReceipt(result?.deployment?.id ?? "");
			setValues({});
			form.reset();
			setSelected([]);
			setTemplateId(templates[0]?.id ?? "");
			router.refresh();
		} catch (err) {
			const msg = getErrorMessage(err, t("deploymentsPage.launch.errorFallback"));
			setError(msg);
			addToast("error", msg);
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="mt-4 grid gap-4">
			<div className="grid gap-3 md:grid-cols-2">
				<label className="ui-label grid gap-1.5">
					{t("deploymentsPage.launch.templateLabel")}
					<select
						name="templateId"
						value={templateId}
						onChange={(event) => { setTemplateId(event.target.value); setValues({}); }}
						className={UI_INPUT}
					>
						{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
					</select>
				</label>
				<label className="ui-label grid gap-1.5">
					{t("deploymentsPage.launch.reasonLabel")}
					<input name="reason" maxLength={500} placeholder={t("deploymentsPage.launch.reasonPlaceholder")} className={UI_INPUT} />
				</label>
			</div>

			{selectedTemplate?.description && <p className="text-xs text-[var(--text-muted)]">{selectedTemplate.description}</p>}

			{variables.length > 0 ? (
				<div data-inset className="p-4">
					<div className="mb-3 flex items-center justify-between gap-3">
						<h3 className="ui-title-group">{t("deploymentsPage.launch.variablesTitle")}</h3>
						<span className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.variablesHint")}</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						{variables.map((name) => (
							<label key={name} className="ui-label grid gap-1.5">
								{name}
								<input name={`variables.${name}`} value={values[name] ?? ""} onChange={e => setValues({ ...values, [name]: e.target.value })} required placeholder={t("deploymentsPage.launch.variablePlaceholder", { name })} className={UI_INPUT} />
							</label>
						))}
					</div>
				</div>
			) : (
				<p data-inset="" className="px-4 py-3 text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.noVariables")}</p>
			)}

			<div>
				<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<h3 className="ui-title-group shrink-0">{t("deploymentsPage.launch.targetVpsTitle")}</h3>
					<span className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.launch.targetVpsHint")}</span>
				</div>
				<ServerTargetPicker kind="deployment" selected={selected} onChange={setSelected} onEnabledCount={setEnabledCount} />
			</div>

			{selectedTemplate?.command && <Disclosure variant="inset" title={t("deploymentsPage.launch.previewCommand")}>
				<code className="ui-mono block max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-elevated)] p-3 text-xs text-[var(--text-secondary)]">{selectedTemplate.command.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name: string) => values[name] || `<${name}>`)}</code>
			</Disclosure>}

			{receipt && <Notice tone="success" compact><ButtonLink href={`/deployments?deploymentId=${encodeURIComponent(receipt)}`} size="sm">{t("deploymentsPage.launch.viewRun")}</ButtonLink></Notice>}
			{error && <Notice tone="danger" compact>{error}</Notice>}
			<ActionButton type="submit" variant="primary" disabled={pending} className="w-fit">{pending ? t("deploymentsPage.launch.submitting") : t("deploymentsPage.launch.submit")}</ActionButton>
		</form>
	);
}
