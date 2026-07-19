"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import { updateStorageNodeAction, type StorageActionState } from "./actions";
import { UI_INPUT } from "@/lib/ui/classes";

const initialState: StorageActionState = {};

export function StorageNodeEditForm({
	node,
	servers,
}: {
	node: {
		id: string;
		name: string;
		driver: string;
		basePath: string;
		isDefault: boolean;
		host?: string | null;
		port?: number | null;
		username?: string | null;
		directAccessMode?:"PROXY" |"DIRECT" |"AUTO" | null;
		publicBaseUrl?: string | null;
		directAccessExpiresSeconds?: number | null;
		serverId?: string | null;
	};
	servers: Array<{ id: string; name: string; host: string }>;
}) {
	const { t } = useI18n();
	const [state, formAction] = useActionState(updateStorageNodeAction, initialState);
	const [driver, setDriver] = useState<string>(node.driver);

	const isSftp = driver ==="SFTP";

	return (
		<form action={formAction} className="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
			<input type="hidden" name="storageNodeId" value={node.id} />

			<div>
				<h3 className="text-lg font-medium text-[var(--text-primary)]">{t("storagePage.form.editTitle")}</h3>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
					<span>{t("storagePage.form.fieldName")}</span>
					<input name="name" defaultValue={node.name} required className={UI_INPUT} />
				</label>
				<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
					<span>{t("storagePage.form.fieldDriver")}</span>
					<select
						name="driver"
						defaultValue={node.driver}
						className={UI_INPUT}
						onChange={(e) => setDriver(e.target.value)}
					>
						<option value="LOCAL">LOCAL</option>
						<option value="SFTP">SFTP</option>
					</select>
				</label>
				<label className="grid gap-2 text-sm text-[var(--text-secondary)] md:col-span-2">
					<span>{t("storagePage.form.fieldBasePath")}</span>
					<input name="basePath" defaultValue={node.basePath} required className={UI_INPUT} placeholder={t("storagePage.form.basePathPlaceholder")} />
				</label>
				{isSftp ? (
					<>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldBindVps")} <span className="text-[var(--danger)]">{t("storagePage.form.fieldBindVpsRequired")}</span></span>
							<select name="serverId" defaultValue={node.serverId ?? ""} className="rounded-2xl border border-[var(--danger-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]">
								<option value="">{t("storagePage.form.optionNotBound")}</option>
								{servers.map((server) => (
									<option key={server.id} value={server.id}>{server.name} · {server.host}</option>
								))}
							</select>
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldRemoteHost")} <span className="text-[var(--danger)]">{t("storagePage.form.fieldRemoteHostRequired")}</span></span>
							<input name="host" defaultValue={node.host ?? ""} className="rounded-2xl border border-[var(--danger-border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]" placeholder={t("storagePage.form.hostPlaceholder")} />
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldPort")}</span>
							<input name="port" type="number" min={1} max={65535} defaultValue={node.port ?? 22} className={UI_INPUT} />
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldUsername")}</span>
							<input name="username" defaultValue={node.username ?? "root"} className={UI_INPUT} />
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)] md:col-span-2">
							<span>{t("storagePage.form.fieldAccessMode")}</span>
							<select name="directAccessMode" defaultValue={node.directAccessMode ?? "PROXY"} className={UI_INPUT}>
								<option value="PROXY">{t("storagePage.form.accessModeProxy")}</option>
								<option value="DIRECT">{t("storagePage.form.accessModeDirect")}</option>
								<option value="AUTO">{t("storagePage.form.accessModeAuto")}</option>
							</select>
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldPublicBaseUrl")}</span>
							<input name="publicBaseUrl" type="url" defaultValue={node.publicBaseUrl ?? ""} className={UI_INPUT} placeholder={t("storagePage.form.publicBaseUrlPlaceholder")} />
						</label>
						<label className="grid gap-2 text-sm text-[var(--text-secondary)]">
							<span>{t("storagePage.form.fieldDirectExpiresSeconds")}</span>
							<input name="directAccessExpiresSeconds" type="number" min={60} max={86400} defaultValue={node.directAccessExpiresSeconds ?? 300} className={UI_INPUT} />
						</label>
					</>
				) : null}
				<label className="flex items-center gap-3 text-sm text-[var(--text-secondary)] md:col-span-2">
					<input name="isDefault" type="checkbox" defaultChecked={node.isDefault} className="h-4 w-4" />
					{t("storagePage.form.fieldIsDefault")}
				</label>
			</div>

			{state.error ? <div data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">{state.error}</div> : null}
			{state.success ? <div data-tone="emerald" className="rounded-2xl border border-[var(--success-border)] px-4 py-3 text-sm text-[var(--success)]">{state.success}</div> : null}

			<div className="flex justify-end"><SubmitButton pendingLabel={t("storagePage.form.submitPending")}>{t("storagePage.form.submitEdit")}</SubmitButton></div>
		</form>
	);
}
