"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import { AGENT_VERSION, isAgentOutdated } from "@/lib/server/agent-version";
import { reinstallServerAgentAction } from "./actions";

/**
 * Repair or upgrade a Linux Agent over SSH. An installed Agent keeps the
 * build it was installed with, so this is also how it gets a new version.
 */
export function ServerAgentReinstall({ serverId, version }: { serverId: string; version: string | null }) {
	const { t } = useI18n();
	const [state, formAction] = useActionState(reinstallServerAgentAction, null);
	const outdated = isAgentOutdated(version);

	return (
		<form action={formAction} className="space-y-1.5">
			<input type="hidden" name="serverId" value={serverId} />
			{outdated ? (
				<p className="text-xs text-[var(--warning)]">{t("serversPage.agent.outdated", { version: version ?? "", latest: AGENT_VERSION })}</p>
			) : null}
			<SubmitButton variant={outdated ? "primary" : "secondary"} pendingLabel={t("serversPage.agent.reinstalling")}>
				{outdated ? t("serversPage.agent.upgrade", { latest: AGENT_VERSION }) : t("serversPage.agent.reinstall")}
			</SubmitButton>
			<p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.agent.reinstallHint")}</p>
			{state?.error ? <p role="alert" className="text-xs text-[var(--danger)]">{state.error}</p> : null}
			{state?.success ? <p role="status" className="text-xs text-[var(--success)]">{state.success}</p> : null}
		</form>
	);
}
