"use client";

import Link from "next/link";
import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getDirectGatewayHealthyNote } from "./direct-gateway-advice";

export function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-3">
			<span className="w-[88px] shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
			<span className="truncate text-sm text-[var(--text-primary)]">{value}</span>
		</div>
	);
}

export function statusToneClass(tone: "success" | "warning" | "info") {
	if (tone === "success") {
		return "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)]";
	}
	if (tone === "warning") {
		return "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] light:border-[var(--warning-border)]";
	}
	return "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]";
}

// TR-041: OS dialect display + detect button
export function OsDialectSection({
	serverId,
	osDialect,
	osInfo,
}: {
	serverId: string;
	osDialect: string | null | undefined;
	osInfo: string | null | undefined;
}) {
	const { t } = useI18n();
	const [detecting, setDetecting] = useState(false);
	const [result, setResult] = useState<{ osInfo: string; dialect: { packageManager: string; serviceManager: string; distroName: string } | null } | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function handleDetect() {
		setDetecting(true);
		setError(null);
		try {
			const res = await csrfFetch<Response>(`/api/servers/${encodeURIComponent(serverId)}/detect-os`, { method: "POST", raw: true });
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || t("serverOverviewDetails.detectionFailed"));
				return;
			}
			setResult({ osInfo: data.osInfo, dialect: data.dialect });
		} catch {
			setError(t("serverOverviewDetails.networkError"));
		} finally {
			setDetecting(false);
		}
	}

	const displayInfo = result?.osInfo ?? osInfo;
	const displayDialect = result?.dialect;
	const hasDialect = displayDialect || osDialect;

	let parsedDialect: { packageManager?: string; serviceManager?: string; distroName?: string } | null = null;
	if (!displayDialect && osDialect) {
		try {
			parsedDialect = JSON.parse(osDialect);
		} catch {
			// ignore parse errors
		}
	}
	const pm = displayDialect?.packageManager ?? parsedDialect?.packageManager;
	const sm = displayDialect?.serviceManager ?? parsedDialect?.serviceManager;

	return (
		<div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2.5">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0 flex-1">
					<span className="text-[11px] text-[var(--text-muted)]">{t("serverOverviewDetails.osDialect")}</span>
					<p className="mt-0.5 truncate text-sm text-[var(--text-primary)]">
						{displayInfo || t("serverOverviewDetails.osNotDetected")}
					</p>
				</div>
				<button
					type="button"
					onClick={handleDetect}
					disabled={detecting}
				 data-action-button data-variant="outline" className="shrink-0 !px-2.5 !py-1 !text-[11px] disabled:opacity-50">
					{detecting ? t("serverOverviewDetails.detecting") : t("serverOverviewDetails.detectOs")}
				</button>
			</div>
			{error ? (
				<p className="mt-1.5 text-[11px] text-[var(--danger)]">{error}</p>
			) : null}
			{hasDialect && (pm || sm) ? (
				<div className="mt-1.5 flex flex-wrap gap-1.5">
					{pm ? (
						<span className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
							{t("serverOverviewDetails.packageManager")}: {pm}
						</span>
					) : null}
					{sm ? (
						<span className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
							{t("serverOverviewDetails.serviceManager")}: {sm}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

// TR-002 R3: advice 项的 tone 决定背景与边框；emerald=safe / amber=warning / rose=danger
function adviceToneClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "border-[var(--success-border)] bg-[var(--success)]/[0.10] light:border-[var(--success-border)] light:bg-[var(--success-bg)]";
	}
	if (tone === "rose") {
		return "border-[var(--danger-border)] bg-[var(--danger)]/[0.10] light:border-[var(--danger-border)] light:bg-[var(--danger-bg)]";
	}
	// amber (default) 与原版一致
	return "border-[var(--warning-border)] light:border-[var(--warning-border)] light:bg-[var(--warning-bg)]";
}

function adviceTitleClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "text-[var(--success)] light:text-[var(--success)]";
	}
	if (tone === "rose") {
		return "text-[var(--danger)] light:text-[var(--danger)]";
	}
	return "text-[var(--warning)] light:text-[var(--warning)]";
}

function adviceBadgeClass(tone: "emerald" | "amber" | "rose" | undefined) {
	if (tone === "emerald") {
		return "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] light:border-[var(--success-border)] light:text-[var(--success)]";
	}
	if (tone === "rose") {
		return "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)] light:border-[var(--danger-border)] light:text-[var(--danger)]";
	}
	return "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] light:border-[var(--warning-border)] light:text-[var(--warning)]";
}

export function DirectGatewayHealthyDetail({
	t,
	statusLabel: dgLabel,
	publicUrl,
}: {
	t: (k: string) => string;
	statusLabel: string;
	publicUrl: string | null;
}) {
	return (
		<p data-testid="direct-gateway-healthy-note">
			{getDirectGatewayHealthyNote(t, { statusLabel: dgLabel, publicUrl })}
		</p>
	);
}

export function DirectGatewayAdviceList({
	t,
	advice,
}: {
	t: (k: string) => string;
	advice: Array<{
		title: string;
		detail: string;
		priority: "primary" | "secondary";
		href: string | null;
		hrefLabel?: string;
		// TR-002 R3: 风险等级 tone，决定色彩。undefined = 沿用 amber 默认
		tone?: "emerald" | "amber" | "rose";
	}>;
}) {
	if (advice.length === 0) return null;
	return (
		<ul
			role="list"
			aria-label={t("serverOverviewDetails.directGatewayRepairAdvice")}
			className="mt-1 space-y-1.5"
		>
			{advice.map((item, index) => (
				<li
					key={`${item.title}-${index}`}
					data-tone={item.tone ?? "amber"}
					className={`rounded-lg border px-2 py-1.5 ${adviceToneClass(item.tone)}`}
				>
					<div className={`flex flex-wrap items-baseline gap-1.5 text-[11px] font-medium leading-5 ${adviceTitleClass(item.tone)}`}>
						<span
							data-priority={item.priority}
							className={
								item.priority === "primary"
									? `rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${adviceBadgeClass(item.tone)}`
									: "rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)] light:border-[var(--border)]"
							}
						>
							{item.priority === "primary" ? t("serverOverviewDetails.recommendation") : t("serverOverviewDetails.reference")}
						</span>
						<span>{item.title}</span>
						{item.href && item.hrefLabel ? (
							<Link
								href={item.href}
								className="ml-auto text-[var(--text-secondary)] underline-offset-4 hover:underline light:text-[var(--accent)]"
								aria-label={item.hrefLabel}
							>
								{item.hrefLabel}
							</Link>
						) : null}
					</div>
					<p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
						{item.detail}
					</p>
				</li>
			))}
		</ul>
	);
}
