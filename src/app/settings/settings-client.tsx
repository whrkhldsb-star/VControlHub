"use client";

import { useState, useCallback, useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import {
	SETTINGS_SCHEMA,
	buildTocItems,
	getSectionSaveKeys,
	type BadgeTone,
	type FieldDef,
	type SectionDef,
} from "./field-schema";

type Props = {
	settings: Record<string, string>;
	runtimeSettings?: RuntimeSettingSummary[];
	settingUpdateMetadata?: Record<string, SettingUpdateMetadata>;
	canManage: boolean;
	twoFactorEnabled?: boolean;
};

function formatMetadataDate(value: Date | string | null) {
	if (!value) return "暂无记录";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "暂无记录";
	return date.toLocaleString("zh-CN", { hour12: false });
}

function latestSectionMetadata(keys: string[], metadata: Record<string, SettingUpdateMetadata>) {
	return (
		keys
			.map((key) => metadata[key])
			.filter((item): item is SettingUpdateMetadata => Boolean(item?.updatedAt))
			.sort(
				(a, b) =>
					new Date(b.updatedAt as Date).getTime() - new Date(a.updatedAt as Date).getTime(),
			)[0] ?? null
	);
}

export function SettingsClient({
	settings: initialSettings,
	runtimeSettings = [],
	settingUpdateMetadata = {},
	canManage,
	twoFactorEnabled = false,
}: Props) {
	const [settings, setSettings] = useState(initialSettings);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Initial defaults from schema (defaultOpen).
	const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, s.defaultOpen])),
	);

	const handleToggle = useCallback(
		(id: string) => (event: SyntheticEvent<HTMLDetailsElement>) => {
			const isOpen = (event.currentTarget as HTMLDetailsElement)?.open ?? false;
			setOpenSections((prev) => ({ ...prev, [id]: isOpen }));
		},
		[],
	);

	const expandAll = useCallback(() => {
		setOpenSections(Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, true])));
	}, []);
	const collapseAll = useCallback(() => {
		setOpenSections(Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, false])));
	}, []);

	// Apply URL hash (e.g. /settings#runtime) on mount: open the section and scroll into view.
	const hashAppliedRef = useRef(false);
	useEffect(() => {
		if (hashAppliedRef.current) return;
		if (typeof window === "undefined") return;
		const hash = window.location.hash.replace(/^#/, "");
		if (!hash) return;
		if (SETTINGS_SCHEMA.some((s) => s.id === hash)) {
			hashAppliedRef.current = true;
			// eslint-disable-next-line react-hooks/set-state-in-effect -- 客户端读取 window.location.hash 后才能决定是否展开对应分组；SSR 阶段无法获得 hash。
			setOpenSections((prev) => ({ ...prev, [hash]: true }));
			// Defer scroll so the <details> has time to expand.
			setTimeout(() => {
				const el = document.getElementById(hash);
				el?.scrollIntoView({ behavior: "smooth", block: "start" });
			}, 50);
		}
	}, []);

	const updateField = (key: string, value: string) => {
		setSettings((prev) => ({ ...prev, [key]: value }));
		setSaved(false);
		setSavedMessage(null);
	};
	const runtimeSummaryByKey = new Map(runtimeSettings.map((item) => [item.key, item]));

	const handleSave = useCallback(
		async (section: SectionDef) => {
			const keys = getSectionSaveKeys(section);
			if (keys.length === 0) return;
			const validationErrors = keys
				.map((key) => {
					const field = section.fields.find((f) => f.key === key);
					return field?.validate ? field.validate(settings[key] ?? "", settings) : null;
				})
				.filter((message): message is string => Boolean(message));
			if (validationErrors.length > 0) {
				setError(validationErrors.join("；"));
				setSaved(false);
				setSavedMessage(null);
				return;
			}
			setSaving(true);
			setError(null);
			try {
				const payload: Record<string, string> = {};
				for (const k of keys) {
					payload[k] = settings[k] ?? "";
				}
				await csrfFetch("/api/settings", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				setSaved(true);
				setSavedMessage(section.saveMessage || "设置已保存。");
				setTimeout(() => {
					setSaved(false);
					setSavedMessage(null);
				}, 5000);
			} catch (err) {
				setError(err instanceof Error ? err.message : "保存失败");
			} finally {
				setSaving(false);
			}
		},
		[settings],
	);

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
				<div className="text-4xl mb-3">🔒</div>
				<p className="text-sm text-slate-500">当前角色无系统设置权限</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{error && (
				<div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-4 py-3 text-sm text-rose-200">{error}</div>
			)}
			{saved && (
				<div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-400/20 px-4 py-3 text-sm text-emerald-200">
					✓ 设置已保存{savedMessage ? ` — ${savedMessage}` : ""}
				</div>
			)}

			{/* Quick-jump TOC + expand/collapse all */}
			<nav aria-label="设置分类导航" className="p-4 space-y-3" data-card>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 className="text-sm font-semibold text-white">⚙️ 设置分类</h2>
						<p className="mt-0.5 text-xs text-slate-500">点击下方分类快速跳转，或一键展开/折叠所有分组。常用项默认展开，运行参数等高级项默认折叠。</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={expandAll}
							className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
						>
							全部展开
						</button>
						<button
							type="button"
							onClick={collapseAll}
							className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
						>
							全部折叠
						</button>
					</div>
				</div>
				<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
					{buildTocItems().map((item) => (
						<a
							key={item.id}
							href={`#${item.id}`}
							onClick={() => setOpenSections((prev) => ({ ...prev, [item.id]: true }))}
							className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.01] px-3 py-2 text-xs transition hover:border-cyan-400/30 hover:bg-cyan-500/[0.05]"
						>
							<span className="text-base" aria-hidden>{item.icon}</span>
							<span className="flex-1 min-w-0">
								<span className="block font-semibold text-white truncate">{item.title}</span>
								<span className="block text-[11px] text-slate-500 truncate">{item.subtitle}</span>
							</span>
							<span className="text-cyan-300 opacity-0 transition group-hover:opacity-100" aria-hidden>→</span>
						</a>
					))}
				</div>
			</nav>

			{SETTINGS_SCHEMA.map((section) => (
				<SchemaDrivenSection
					key={section.id}
					section={section}
					open={openSections[section.id] ?? section.defaultOpen}
					onToggle={handleToggle(section.id)}
					settings={settings}
					updateField={updateField}
					runtimeSummaryByKey={runtimeSummaryByKey}
					auditMetadata={latestSectionMetadata(getSectionSaveKeys(section), settingUpdateMetadata)}
					saving={saving}
					onSave={() => handleSave(section)}
					twoFactorEnabled={twoFactorEnabled}
				/>
			))}
		</div>
	);
}

/* ── Section renderer ────────────────────────────────────── */

type SchemaDrivenSectionProps = {
	section: SectionDef;
	open: boolean;
	onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
	settings: Record<string, string>;
	updateField: (key: string, value: string) => void;
	runtimeSummaryByKey: Map<string, RuntimeSettingSummary>;
	auditMetadata: SettingUpdateMetadata | null;
	saving: boolean;
	onSave: () => void;
	twoFactorEnabled: boolean;
};

function SchemaDrivenSection({
	section,
	open,
	onToggle,
	settings,
	updateField,
	runtimeSummaryByKey,
	auditMetadata,
	saving,
	onSave,
	twoFactorEnabled,
}: SchemaDrivenSectionProps) {
	const Inner = section.asForm ? "form" : "div";
	const saveKeys = getSectionSaveKeys(section);
	const hasSaveButton = saveKeys.length > 0;
	const description = typeof section.description === "function" ? section.description(settings) : section.description;
	const badge = typeof section.badge === "function" ? section.badge(settings) : section.badge;
	const badgeToneRaw = typeof section.badgeTone === "function" ? section.badgeTone(settings) : section.badgeTone;
	const badgeTone: BadgeTone = badgeToneRaw ?? "cyan";

	// SMTP 的 header switch 渲染到 headerExtra 里。
	const headerSwitchField = section.headerSwitchKey
		? section.fields.find((f) => f.key === section.headerSwitchKey)
		: undefined;
	const headerExtra = (
		<div className="flex flex-col gap-3 lg:items-end">
			<AuditSummary metadata={auditMetadata} />
			{headerSwitchField && (
				<SwitchField
					label={headerSwitchField.label}
					value={settings[headerSwitchField.key] === "true"}
					onChange={(v) => updateField(headerSwitchField.key, v ? "true" : "false")}
				/>
			)}
		</div>
	);

	return (
		<CollapsibleSection
			id={section.id}
			icon={section.icon}
			title={section.title}
			description={description}
			badge={
				badge ??
				(hasSaveButton
					? `${saveKeys.length}${section.id === "runtime" ? " 项 · 高级" : " 项"}`
					: section.id === "2fa" ? "2FA" : undefined)
			}
			badgeTone={badgeTone}
			open={open}
			onToggle={onToggle}
			headerExtra={headerExtra}
			asForm={section.asForm}
		>
			{section.id === "2fa" ? (
				<TwoFactorSettings enabled={twoFactorEnabled} />
			) : (
				<>
					{section.noticeBanner && (
						<div
							data-tone="cyan"
							className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-100 light:border-cyan-200 light:bg-cyan-50"
						>
							{section.noticeBanner}
						</div>
					)}
					{(() => {
						const renderableFields = section.fields.filter(
							(f) => f.key !== section.headerSwitchKey,
						);
						const gridClass =
							section.layout === "grid-2"
								? "grid gap-4 md:grid-cols-2"
								: "space-y-4";
						const gridAttrs =
							section.id === "smtp"
								? { "aria-disabled": settings["smtp.enabled"] !== "true" }
								: {};
						return (
							<div className={gridClass} {...gridAttrs}>
								{renderableFields.map((field) => {
									const helperText =
										typeof field.helperText === "function"
											? field.helperText(settings)
											: field.helperText;
									const disabled = field.disabled ? field.disabled(settings) : false;
									const value = settings[field.key] ?? field.defaultValue ?? "";
									return (
										<FieldRenderer
											key={field.key}
											field={field}
											value={value}
											disabled={disabled}
											helperText={helperText}
											onChange={(v) => updateField(field.key, v)}
											runtimeSummary={runtimeSummaryByKey.get(field.key)}
										/>
									);
								})}
							</div>
						);
					})()}
					{hasSaveButton && <SaveButton onClick={onSave} saving={saving} />}
				</>
			)}
		</CollapsibleSection>
	);
}

/* ── Sub-components ──────────────────────────────────────── */

const BADGE_COLOR_CLASSES: Record<BadgeTone, string> = {
	cyan: "bg-cyan-500/[0.12] text-cyan-200 border-cyan-400/30",
	emerald: "bg-emerald-500/[0.12] text-emerald-200 border-emerald-400/30",
	amber: "bg-amber-500/[0.12] text-amber-200 border-amber-400/30",
	slate: "bg-slate-500/[0.12] text-slate-300 border-slate-400/30",
};

type CollapsibleSectionProps = {
	id: string;
	icon: string;
	title: string;
	description: string;
	badge?: string;
	badgeTone?: BadgeTone;
	open: boolean;
	onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
	headerExtra?: ReactNode;
	asForm?: boolean;
	children: ReactNode;
};

function CollapsibleSection({
	id,
	icon,
	title,
	description,
	badge,
	badgeTone = "cyan",
	open,
	onToggle,
	headerExtra,
	asForm = false,
	children,
}: CollapsibleSectionProps) {
	const Inner = asForm ? "form" : "div";
	const badgeClass = BADGE_COLOR_CLASSES[badgeTone] ?? BADGE_COLOR_CLASSES.cyan;
	return (
		<section id={id} className="scroll-mt-24" data-card>
			<details open={open} onToggle={onToggle} className="group">
				<summary
					className="cursor-pointer list-none p-5 transition hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 rounded-xl"
					aria-label={`${open ? "折叠" : "展开"} ${title} 设置区`}
				>
					<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
						<div className="flex items-start gap-3 min-w-0 flex-1">
							<span
								aria-hidden
								className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition group-open:rotate-90"
							>
								▶
							</span>
							<div className="min-w-0 flex-1">
								<h2 className="text-lg font-semibold text-white flex items-center gap-2 flex-wrap">
									<span aria-hidden>{icon}</span>
									<span>{title}</span>
									{badge && (
										<span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${badgeClass}`}>{badge}</span>
									)}
								</h2>
								<p className="mt-1 text-xs text-slate-500">{description}</p>
							</div>
						</div>
						{headerExtra && (
							<div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="lg:flex-shrink-0">
								{headerExtra}
							</div>
						)}
					</div>
				</summary>
				<Inner
					className="px-5 pb-5 pt-1 space-y-4"
					{...(asForm ? { onSubmit: (event: React.FormEvent) => event.preventDefault() } : {})}
				>
					{children}
				</Inner>
			</details>
		</section>
	);
}

function AuditSummary({ metadata }: { metadata: SettingUpdateMetadata | null }) {
	return (
		<div data-tone="amber" className="rounded-lg border border-amber-400/20 px-3 py-2 text-xs text-amber-100 light:border-amber-200 light:bg-amber-50">
			<p className="font-semibold">最近修改</p>
			<p>时间：{formatMetadataDate(metadata?.updatedAt ?? null)}</p>
			<p>修改人：{metadata?.actorName ?? "暂无审计记录"}</p>
		</div>
	);
}

type FieldRendererProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
	runtimeSummary: RuntimeSettingSummary | undefined;
};

function FieldRenderer({ field, value, disabled, helperText, onChange, runtimeSummary }: FieldRendererProps) {
	if (field.type === "switch") {
		return (
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-slate-300">{field.label}</span>
				<SwitchField
					label={field.label}
					value={value === "true"}
					onChange={(v) => onChange(v ? "true" : "false")}
				/>
			</div>
		);
	}
	if (field.type === "textarea") {
		return (
			<TextAreaField
				field={field}
				value={value}
				disabled={disabled}
				helperText={helperText}
				onChange={onChange}
			/>
		);
	}
	return (
		<InputField
			field={field}
			value={value}
			disabled={disabled}
			helperText={helperText}
			onChange={onChange}
			runtimeSummary={runtimeSummary}
		/>
	);
}

type InputFieldProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
	runtimeSummary: RuntimeSettingSummary | undefined;
};

function InputField({ field, value, disabled, helperText, onChange, runtimeSummary }: InputFieldProps) {
	const inputId = useId();
	const helperId = useId();
	const runtimeId = useId();
	const describedBy =
		[helperText ? helperId : null, runtimeSummary ? runtimeId : null].filter(Boolean).join(" ") || undefined;
	return (
		<div
			className={`space-y-1.5 rounded-lg border p-3 transition ${
				disabled
					? "border-white/[0.04] bg-slate-950/20 opacity-70 light:bg-slate-100/80"
					: "border-transparent bg-white/[0.01]"
			}`}
		>
			<label htmlFor={inputId} className="block text-xs font-semibold text-white tracking-wide">
				{field.label}
			</label>
			<input
				id={inputId}
				type={field.type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={field.placeholder}
				autoComplete={field.autoComplete}
				disabled={disabled}
				aria-describedby={describedBy}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-white/[0.03] disabled:bg-slate-900/50 disabled:text-slate-500 disabled:placeholder:text-white/10 light:placeholder:text-slate-400 light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-slate-500 light:disabled:placeholder:text-slate-300"
			/>
			{helperText && (
				<p id={helperId} className="text-xs text-white">
					{helperText}
				</p>
			)}
			{runtimeSummary && (
				<div
					id={runtimeId}
					className="rounded-md border border-white/[0.06] bg-slate-950/30 px-2.5 py-2 text-[11px] leading-5 text-slate-300"
				>
					<p>
						当前运行值：<strong className="text-white">{runtimeSummary.value}</strong> {runtimeSummary.unit} · 来源：{runtimeSummary.sourceLabel}
					</p>
					<p>生效位置：{runtimeSummary.applies}</p>
					<p>
						环境变量：<code>{runtimeSummary.env}</code> · 范围：{runtimeSummary.min}–{runtimeSummary.max}
						{runtimeSummary.unit}
					</p>
					{runtimeSummary.requiresRestart && (
						<p className="font-medium text-amber-200">保存后需重启对应服务才会改变已启动进程。</p>
					)}
				</div>
			)}
		</div>
	);
}

type TextAreaFieldProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
};

function TextAreaField({ field, value, disabled, helperText, onChange }: TextAreaFieldProps) {
	const inputId = useId();
	const helperId = useId();
	return (
		<div
			className={`space-y-1.5 rounded-lg border p-3 transition ${
				disabled ? "border-white/[0.04] bg-slate-950/20 opacity-70" : "border-transparent bg-white/[0.01]"
			}`}
		>
			<label htmlFor={inputId} className="block text-xs font-semibold text-white tracking-wide">
				{field.label}
			</label>
			<textarea
				id={inputId}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={field.placeholder}
				disabled={disabled}
				aria-describedby={helperText ? helperId : undefined}
				rows={4}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed"
			/>
			{helperText && (
				<p id={helperId} className="text-xs text-white">
					{helperText}
				</p>
			)}
		</div>
	);
}

function SwitchField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm text-slate-300">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={value}
				aria-label={label}
				onClick={() => onChange(!value)}
				className={`relative w-10 h-5 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${value ? "bg-cyan-500" : "bg-slate-700"}`}
			>
				<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : ""}`} />
			</button>
		</div>
	);
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
	return (
		<div className="pt-2">
			<button
				onClick={onClick}
				disabled={saving}
				className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
			>
				{saving ? "保存中…" : "保存"}
			</button>
		</div>
	);
}
