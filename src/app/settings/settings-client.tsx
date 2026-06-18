"use client";

import { useState, useCallback, useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TwoFactorSettingsLazy } from "./two-factor-settings-lazy";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
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

function formatMetadataDate(value: Date | string | null, t: (key: string) => string) {
	if (!value) return t("settingsClient.metadataNoRecord");
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return t("settingsClient.metadataNoRecord");
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

// ── TR-014 M01b ──

export type PendingChange = {
	key: string;
	label: string;
	oldValue: string;
	newValue: string;
	riskLevel: "low" | "medium" | "high";
	sectionId: string;
};

/** 比较当前 settings 与初始 settings, 返回已修改的字段列表 (按 section 顺序)。 */
function getPendingChanges(
	sections: SectionDef[],
	settings: Record<string, string>,
	initialSettings: Record<string, string>,
): PendingChange[] {
	const out: PendingChange[] = [];
	for (const section of sections) {
		for (const field of section.fields) {
			const newValue = settings[field.key] ?? "";
			const oldValue = initialSettings[field.key] ?? "";
			if (newValue === oldValue) continue;
			out.push({
				key: field.key,
				label: field.label,
				oldValue,
				newValue,
				riskLevel: field.riskLevel ?? "low",
				sectionId: section.id,
			});
		}
	}
	return out;
}

/** 把任意 string 值截断并转义, 适合在 diff modal 表格里展示。空值显示 "（空）"。 */
function renderDiffValue(value: string, t: (key: string) => string, max = 60): string {
	if (value === "") return t("settingsClient.emptyValue");
	if (value.length <= max) return value;
	return `${value.slice(0, max)}…`;
}

export function SettingsClient({
	settings: initialSettings,
	runtimeSettings = [],
	settingUpdateMetadata = {},
	canManage,
	twoFactorEnabled = false,
}: Props) {
	const { t } = useI18n();
	const [settings, setSettings] = useState(initialSettings);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// TR-014 M01b: 保存高风险设置前的二次确认 modal
	const [highRiskConfirm, setHighRiskConfirm] = useState<{
		changes: PendingChange[];
		execute: () => void;
	} | null>(null);
	// TR-014 M01b: 每个 section 的 diff 角标展开状态
	const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
	// TR-014 M02: 用户失焦过高风险且已改字段时, 在字段下方显示 inline 警告,
	// 直到保存或字段值回到初值。`Set` 比 `Record` 更省重渲染键比较。
	const [blurredHighRiskKeys, setBlurredHighRiskKeys] = useState<Set<string>>(() => new Set());

	// Initial defaults from schema (defaultOpen).
	const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, s.defaultOpen])),
	);

	// TR-014 M02: 失焦时若高风险且值已变, 把字段 key 加入警告集合。
	// 仅在 level==='high' 且 newValue !== initialValue 时触发 — 其它情况不打扰。
	const handleHighRiskBlur = useCallback(
		(field: FieldDef, currentValue: string) => {
			if (field.riskLevel !== "high") return;
			const initialValue = initialSettings[field.key] ?? "";
			if (currentValue === initialValue) return;
			setBlurredHighRiskKeys((prev) => {
				if (prev.has(field.key)) return prev;
				const next = new Set(prev);
				next.add(field.key);
				return next;
			});
		},
		[initialSettings],
	);

	// TR-014 M02: 用户继续改值时清除该字段的警告 (可能改回初始值或新值, 让用户重新触发失焦再决定)。
	const clearHighRiskBlur = useCallback((field: FieldDef) => {
		setBlurredHighRiskKeys((prev) => {
			if (!prev.has(field.key)) return prev;
			const next = new Set(prev);
			next.delete(field.key);
			return next;
		});
	}, []);

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
			// TR-014 M02: 保存成功后清掉所有高风险失焦警告 (字段已持久化, 警告使命完成)
			setBlurredHighRiskKeys(new Set());
			// TR-014 M01b: 如果本 section 的 pending changes 里有 high 风险, 弹 confirm modal
			const pendingForSection = getPendingChanges([section], settings, initialSettings);
			const highChanges = pendingForSection.filter((c) => c.riskLevel === "high");
			const performSave = async () => {
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
					setSavedMessage(section.saveMessage || t("settingsClient.saveSuccess"));
					setTimeout(() => {
						setSaved(false);
						setSavedMessage(null);
					}, 5000);
				} catch (err) {
					setError(err instanceof Error ? err.message : t("settingsClient.saveFailed"));
				} finally {
					setSaving(false);
				}
			};
			if (highChanges.length > 0) {
				setHighRiskConfirm({ changes: highChanges, execute: () => void performSave() });
				return;
			}
			await performSave();
		},
		[settings, initialSettings],
	);

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
				<div className="text-4xl mb-3">🔒</div>
				<p className="text-sm text-slate-500">{t("settingsClient.noPermission")}</p>
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
					{t("settingsClient.savedWithMessage")}{savedMessage ? ` — ${savedMessage}` : ""}
				</div>
			)}

			{/* Quick-jump TOC + expand/collapse all */}
			<nav aria-label={t("settingsClient.categoryNav")} className="p-4 space-y-3" data-card>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 className="text-sm font-semibold text-white">{t("settingsClient.categoryTitle")}</h2>
						<p className="mt-0.5 text-xs text-slate-500">{t("settingsClient.categoryDescription")}</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={expandAll}
							className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
						>
							{t("settingsClient.expandAll")}
						</button>
						<button
							type="button"
							onClick={collapseAll}
							className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
						>
							{t("settingsClient.collapseAll")}
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
					initialSettings={initialSettings}
					updateField={updateField}
					runtimeSummaryByKey={runtimeSummaryByKey}
					auditMetadata={latestSectionMetadata(getSectionSaveKeys(section), settingUpdateMetadata)}
					saving={saving}
					onSave={() => handleSave(section)}
					twoFactorEnabled={twoFactorEnabled}
					diffExpanded={expandedDiffs[section.id] ?? false}
					onToggleDiff={() => setExpandedDiffs((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
					blurredHighRiskKeys={blurredHighRiskKeys}
					onHighRiskBlur={handleHighRiskBlur}
					onHighRiskChange={clearHighRiskBlur}
				/>
			))}
			{highRiskConfirm && (
				<HighRiskConfirmModal
					changes={highRiskConfirm.changes}
					onCancel={() => setHighRiskConfirm(null)}
					onConfirm={async () => {
						const exec = highRiskConfirm.execute;
						setHighRiskConfirm(null);
						await exec();
					}}
				/>
			)}
		</div>
	);
}

/* ── Section renderer ────────────────────────────────────── */

type SchemaDrivenSectionProps = {
	section: SectionDef;
	open: boolean;
	onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
	settings: Record<string, string>;
	initialSettings: Record<string, string>;
	updateField: (key: string, value: string) => void;
	runtimeSummaryByKey: Map<string, RuntimeSettingSummary>;
	auditMetadata: SettingUpdateMetadata | null;
	saving: boolean;
	onSave: () => void;
	twoFactorEnabled: boolean;
	diffExpanded: boolean;
	onToggleDiff: () => void;
	// TR-014 M02
	blurredHighRiskKeys: Set<string>;
	onHighRiskBlur: (field: FieldDef, currentValue: string) => void;
	onHighRiskChange: (field: FieldDef) => void;
};

function SchemaDrivenSection({
	section,
	open,
	onToggle,
	settings,
	initialSettings,
	updateField,
	runtimeSummaryByKey,
	auditMetadata,
	saving,
	onSave,
	twoFactorEnabled,
	diffExpanded,
	onToggleDiff,
	blurredHighRiskKeys,
	onHighRiskBlur,
	onHighRiskChange,
}: SchemaDrivenSectionProps) {
	const { t } = useI18n();
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
					? `${saveKeys.length}${section.id === "runtime" ? t("settingsClient.sectionItemsSuffixAdvanced") : t("settingsClient.sectionItemsSuffix")}`
					: section.id === "2fa" ? "2FA" : undefined)
			}
			badgeTone={badgeTone}
			open={open}
			onToggle={onToggle}
			headerExtra={headerExtra}
			asForm={section.asForm}
		>
			{section.id === "2fa" ? (
				<TwoFactorSettingsLazy enabled={twoFactorEnabled} />
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
											onChange={(v) => {
												updateField(field.key, v);
												onHighRiskChange(field);
											}}
											runtimeSummary={runtimeSummaryByKey.get(field.key)}
											showHighRiskWarning={blurredHighRiskKeys.has(field.key)}
											onHighRiskBlur={(currentValue) => onHighRiskBlur(field, currentValue)}
										/>
									);
								})}
							</div>
						);
					})()}
					{hasSaveButton && (
					<SaveButtonWithDiff
						pendingChanges={getPendingChanges([section], settings, initialSettings)}
						expanded={diffExpanded}
						onToggleExpand={onToggleDiff}
						saving={saving}
						onClick={onSave}
					/>
				)}
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
	const { t } = useI18n();
	const Inner = asForm ? "form" : "div";
	const badgeClass = BADGE_COLOR_CLASSES[badgeTone] ?? BADGE_COLOR_CLASSES.cyan;
	return (
		<section id={id} className="scroll-mt-24" data-card>
			<details open={open} onToggle={onToggle} className="group">
				<summary
					className="cursor-pointer list-none p-5 transition hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 rounded-xl"
					aria-label={`${open ? t("settingsClient.collapse") : t("settingsClient.expand")} ${title} ${t("settingsClient.sectionSuffix")}`}
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
	const { t } = useI18n();
	return (
		<div data-tone="amber" className="rounded-lg border border-amber-400/20 px-3 py-2 text-xs text-amber-100 light:border-amber-200 light:bg-amber-50">
			<p className="font-semibold">{t("settingsClient.recentlyUpdated")}</p>
			<p>{t("settingsClient.metadataTime")}{formatMetadataDate(metadata?.updatedAt ?? null, t)}</p>
			<p>{t("settingsClient.metadataActor")}{metadata?.actorName ?? t("settingsClient.metadataNoActor")}</p>
		</div>
	);
}

// ── TR-014 设置页高风险设置 (M01a) ─────────────────────────

/**
 * 风险等级徽标 (high/medium 时显示)。low 返 null — 多数字段不打扰用户。
 * 颜色与 `src/app/servers/server-overview-details.tsx` 的 advice tone 保持同一调。
 * 可见文本用 sr-only 隐藏 (testing-library getByLabelText 默认 exact=true,
 * 兄弟节点文本会让它 fail); 视觉靠图标 (⚠) + 边框 + 背景传达。
 */
function FieldRiskBadge({ level }: { level: "low" | "medium" | "high" | undefined }) {
	const { t } = useI18n();
	if (!level || level === "low") return null;
	const className =
		level === "high"
			? "inline-flex items-center gap-0.5 rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-200 light:border-rose-700/25 light:bg-rose-50 light:text-rose-800"
			: "inline-flex items-center gap-0.5 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200 light:border-amber-700/25 light:bg-amber-50 light:text-amber-800";
	const label = level === "high" ? t("settingsClient.riskHigh") : t("settingsClient.riskMedium");
	const description = level === "high"
		? t("settingsClient.riskHighDescription")
		: t("settingsClient.riskMediumDescription");
	return (
		<span data-risk={level} title={description} aria-label={label} className={className}>
			<span aria-hidden>⚠</span>
			<span className="sr-only">{label}</span>
		</span>
	);
}

/**
 * 字段级"恢复默认"小按钮。
 * - 仅在有 `defaultValue` 的非 password 字段上渲染 (password 避免误清空, 但仍接受显式 rollbackable=true)
 * - 当前值已是 defaultValue 或为空时禁用 (避免无操作)
 * - 点击把字段值重置为 defaultValue
 */
function FieldRollbackButton({
	field,
	value,
	onChange,
	disabled,
}: {
	field: FieldDef;
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
}) {
	const { t } = useI18n();
	const supportsRollback =
		field.rollbackable !== false &&
		field.defaultValue !== undefined &&
		field.type !== "password";
	if (!supportsRollback) return null;
	const isAtDefault = value === field.defaultValue || value === "";
	return (
		<button
			type="button"
			onClick={() => onChange(field.defaultValue ?? "")}
			disabled={disabled || isAtDefault}
			title={isAtDefault ? t("settingsClient.fieldIsDefault") : t("settingsClient.fieldRestoreDefault").replace("{value}", field.defaultValue ?? "")}
			aria-label={t("settingsClient.fieldRestoreAria").replace("{label}", field.label)}
			className="inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.06] hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40 light:bg-slate-50 light:hover:border-cyan-500/40 light:hover:text-cyan-700"
		>
			<span aria-hidden>↺</span>
			{/* 可见文本用 sr-only 隐藏避免污染父 label.textContent; 视觉只看图标 ↺ */}
			<span className="sr-only">{t("settingsClient.fieldDefaultSr")}</span>
		</button>
	);
}

/** label 行 chrome: 各 field 组件 inline 调用 FieldRiskBadge + FieldRollbackButton,
 * 这样保留 label htmlFor=inputId 的 a11y 关联 (点击 label 仍 focus input)。
 * 不抽 wrapper 是因为不同 field 用的 label tag 元素略不同 (select/textarea/input)。
 *
 * TR-014 M01a test-friendly: 三个 helper 都被 `export` 出去, 让单测能独立验证
 * 风险徽标 / 恢复默认按钮的行为, 不需要起整个 settings-client. */
export { FieldRiskBadge, FieldRollbackButton };

type FieldRendererProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
	runtimeSummary: RuntimeSettingSummary | undefined;
	// TR-014 M02
	showHighRiskWarning: boolean;
	onHighRiskBlur: (currentValue: string) => void;
};

function FieldRenderer({ field, value, disabled, helperText, onChange, runtimeSummary, showHighRiskWarning, onHighRiskBlur }: FieldRendererProps) {
	const { t } = useI18n();
	if (field.type === "switch") {
		return (
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-slate-300">{field.label}</span>
				<SwitchField
					label={field.label}
					riskLevel={field.riskLevel}
					value={value === "true"}
					onChange={(v) => onChange(v ? "true" : "false")}
				/>
			</div>
		);
	}
	if (field.type === "select") {
		return (
			<SelectField
				field={field}
				value={value}
				disabled={disabled}
				helperText={helperText}
				onChange={onChange}
				runtimeSummary={runtimeSummary}
				showHighRiskWarning={showHighRiskWarning}
				onHighRiskBlur={onHighRiskBlur}
			/>
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
				showHighRiskWarning={showHighRiskWarning}
				onHighRiskBlur={onHighRiskBlur}
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
			showHighRiskWarning={showHighRiskWarning}
			onHighRiskBlur={onHighRiskBlur}
		/>
	);
}

type SelectFieldProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
	runtimeSummary: RuntimeSettingSummary | undefined;
	// TR-014 M02
	showHighRiskWarning: boolean;
	onHighRiskBlur: (currentValue: string) => void;
};

function SelectField({ field, value, disabled, helperText, onChange, runtimeSummary, showHighRiskWarning, onHighRiskBlur }: SelectFieldProps) {
	const { t } = useI18n();
	const inputId = useId();
	const helperId = useId();
	const runtimeId = useId();
	const warningId = useId();
	const describedBy =
		[helperText ? helperId : null, runtimeSummary ? runtimeId : null, showHighRiskWarning ? warningId : null]
			.filter(Boolean)
			.join(" ") || undefined;
	const options = field.options ?? [];
	// If the persisted value is not in the option list (legacy rows, custom edit),
	// still render it as the current selection so users can see and switch away.
	const normalizedValue = options.some((opt) => opt.value === value) ? value : (field.defaultValue ?? options[0]?.value ?? "");
	return (
		<div
			className={`space-y-1.5 rounded-lg border p-3 transition ${
				disabled
					? "border-white/[0.04] bg-slate-950/20 opacity-70 light:bg-slate-100/80"
					: "border-transparent bg-white/[0.01]"
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={inputId} className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-white tracking-wide">
					{field.label}
				</label>
				<FieldRiskBadge level={field.riskLevel} />
				<FieldRollbackButton field={field} value={value} onChange={onChange} disabled={disabled} />
			</div>
			<select
				id={inputId}
				value={normalizedValue}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => onHighRiskBlur(normalizedValue)}
				disabled={disabled}
				aria-describedby={describedBy}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-white/[0.03] disabled:bg-slate-900/50 disabled:text-slate-500 light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-slate-500"
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value} className="bg-slate-900 text-white">
						{opt.label}
					</option>
				))}
			</select>
			{showHighRiskWarning && (
				<p
					id={warningId}
					role="alert"
					data-testid="high-risk-blur-warning"
					className="rounded-md border border-rose-400/30 bg-rose-500/[0.08] px-2.5 py-1.5 text-[11px] leading-5 text-rose-100 light:border-rose-300/40 light:bg-rose-50 light:text-rose-800"
				>
					<span aria-hidden className="mr-1">⚠</span>
					{t("settingsClient.highRiskWarning")}
				</p>
			)}
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
						{t("settingsClient.runtimeValueLabel")}<strong className="text-white">{runtimeSummary.value}</strong> {runtimeSummary.unit} · {t("settingsClient.runtimeSourceLabel")}{runtimeSummary.sourceLabel}
					</p>
					<p>{t("settingsClient.runtimeAppliesLabel")}{runtimeSummary.applies}</p>
					<p>
						{t("settingsClient.runtimeEnvLabel")}<code>{runtimeSummary.env}</code> · {t("settingsClient.runtimeRangeLabel")}{runtimeSummary.min}–{runtimeSummary.max}
						{runtimeSummary.unit}
					</p>
					{runtimeSummary.requiresRestart && (
						<p className="font-medium text-amber-200">{t("settingsClient.runtimeRestartWarning")}</p>
					)}
				</div>
			)}
		</div>
	);
}

type InputFieldProps = {
	field: FieldDef;
	value: string;
	disabled: boolean;
	helperText: string | undefined;
	onChange: (value: string) => void;
	runtimeSummary: RuntimeSettingSummary | undefined;
	// TR-014 M02
	showHighRiskWarning: boolean;
	onHighRiskBlur: (currentValue: string) => void;
};

function InputField({ field, value, disabled, helperText, onChange, runtimeSummary, showHighRiskWarning, onHighRiskBlur }: InputFieldProps) {
	const { t } = useI18n();
	const inputId = useId();
	const helperId = useId();
	const runtimeId = useId();
	const warningId = useId();
	const describedBy =
		[helperText ? helperId : null, runtimeSummary ? runtimeId : null, showHighRiskWarning ? warningId : null]
			.filter(Boolean)
			.join(" ") || undefined;
	return (
		<div
			className={`space-y-1.5 rounded-lg border p-3 transition ${
				disabled
					? "border-white/[0.04] bg-slate-950/20 opacity-70 light:bg-slate-100/80"
					: "border-transparent bg-white/[0.01]"
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={inputId} className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-white tracking-wide">
					{field.label}
				</label>
				<FieldRiskBadge level={field.riskLevel} />
				<FieldRollbackButton field={field} value={value} onChange={onChange} disabled={disabled} />
			</div>
			<input
				id={inputId}
				type={field.type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => onHighRiskBlur(value)}
				placeholder={field.placeholder}
				autoComplete={field.autoComplete}
				disabled={disabled}
				aria-describedby={describedBy}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-white/[0.03] disabled:bg-slate-900/50 disabled:text-slate-500 disabled:placeholder:text-white/10 light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-slate-500 light:disabled:placeholder:text-slate-300"
			/>
			{showHighRiskWarning && (
				<p
					id={warningId}
					role="alert"
					data-testid="high-risk-blur-warning"
					className="rounded-md border border-rose-400/30 bg-rose-500/[0.08] px-2.5 py-1.5 text-[11px] leading-5 text-rose-100 light:border-rose-300/40 light:bg-rose-50 light:text-rose-800"
				>
					<span aria-hidden className="mr-1">⚠</span>
					{t("settingsClient.highRiskWarning")}
				</p>
			)}
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
						{t("settingsClient.runtimeValueLabel")}<strong className="text-white">{runtimeSummary.value}</strong> {runtimeSummary.unit} · {t("settingsClient.runtimeSourceLabel")}{runtimeSummary.sourceLabel}
					</p>
					<p>{t("settingsClient.runtimeAppliesLabel")}{runtimeSummary.applies}</p>
					<p>
						{t("settingsClient.runtimeEnvLabel")}<code>{runtimeSummary.env}</code> · {t("settingsClient.runtimeRangeLabel")}{runtimeSummary.min}–{runtimeSummary.max}
						{runtimeSummary.unit}
					</p>
					{runtimeSummary.requiresRestart && (
						<p className="font-medium text-amber-200">{t("settingsClient.runtimeRestartWarning")}</p>
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
	// TR-014 M02
	showHighRiskWarning: boolean;
	onHighRiskBlur: (currentValue: string) => void;
};

function TextAreaField({ field, value, disabled, helperText, onChange, showHighRiskWarning, onHighRiskBlur }: TextAreaFieldProps) {
	const { t } = useI18n();
	const inputId = useId();
	const helperId = useId();
	const warningId = useId();
	return (
		<div
			className={`space-y-1.5 rounded-lg border p-3 transition ${
				disabled ? "border-white/[0.04] bg-slate-950/20 opacity-70" : "border-transparent bg-white/[0.01]"
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={inputId} className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-white tracking-wide">
					{field.label}
				</label>
				<FieldRiskBadge level={field.riskLevel} />
				<FieldRollbackButton field={field} value={value} onChange={onChange} disabled={disabled} />
			</div>
			<textarea
				id={inputId}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => onHighRiskBlur(value)}
				placeholder={field.placeholder}
				disabled={disabled}
				aria-describedby={[helperText ? helperId : null, showHighRiskWarning ? warningId : null].filter(Boolean).join(" ") || undefined}
				rows={4}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed"
			/>
			{showHighRiskWarning && (
				<p
					id={warningId}
					role="alert"
					data-testid="high-risk-blur-warning"
					className="rounded-md border border-rose-400/30 bg-rose-500/[0.08] px-2.5 py-1.5 text-[11px] leading-5 text-rose-100 light:border-rose-300/40 light:bg-rose-50 light:text-rose-800"
				>
					<span aria-hidden className="mr-1">⚠</span>
					{t("settingsClient.highRiskWarning")}
				</p>
			)}
			{helperText && (
				<p id={helperId} className="text-xs text-white">
					{helperText}
				</p>
			)}
		</div>
	);
}

function SwitchField({ label, riskLevel, value, onChange }: { label: string; riskLevel?: "low" | "medium" | "high"; value: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="flex items-center gap-1.5 text-sm text-slate-300">
				{label}
				<FieldRiskBadge level={riskLevel} />
			</span>
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

// ── TR-014 M01b: SaveButtonWithDiff ──

/**
 * 替代原 SaveButton:
 * - 角标显示本 section 已修改字段数 (无变化时隐藏)
 * - 点击角标展开/折叠 inline diff 表格 (key + before + after + 风险色条)
 * - 真实保存按钮始终在右侧, 高风险修改时按钮文字变红强调
 */
function SaveButtonWithDiff({
	pendingChanges,
	expanded,
	onToggleExpand,
	saving,
	onClick,
}: {
	pendingChanges: PendingChange[];
	expanded: boolean;
	onToggleExpand: () => void;
	saving: boolean;
	onClick: () => void;
}) {
	const { t } = useI18n();
	const count = pendingChanges.length;
	const highCount = pendingChanges.filter((c) => c.riskLevel === "high").length;
	const mediumCount = pendingChanges.filter((c) => c.riskLevel === "medium").length;
	return (
		<div className="pt-2 space-y-2" data-component="save-button-with-diff">
			<div className="flex flex-wrap items-center gap-2">
				{count > 0 && (
					<button
						type="button"
						onClick={onToggleExpand}
						aria-expanded={expanded}
						aria-label={t("settingsClient.expandAria").replace("{count}", String(count)).replace("{expanded}", expanded ? t("settingsClient.collapsed") : t("settingsClient.expanded"))}
						data-pending-count={count}
						className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
							highCount > 0
								? "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15 light:border-rose-700/30 light:bg-rose-50 light:text-rose-800"
								: mediumCount > 0
									? "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15 light:border-amber-700/30 light:bg-amber-50 light:text-amber-800"
									: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15 light:border-cyan-700/30 light:bg-cyan-50 light:text-cyan-800"
						}`}
					>
						<span aria-hidden>{expanded ? "▾" : "▸"}</span>
						<span>
							{count > 0
							? (() => {
								if (highCount > 0) return t("settingsClient.changesCountHighRisk").replace("{count}", String(count)).replace("{high}", String(highCount));
								if (mediumCount > 0) return t("settingsClient.changesCountMediumRisk").replace("{count}", String(count)).replace("{medium}", String(mediumCount));
								return t("settingsClient.changesCount").replace("{count}", String(count));
							})()
							: ""}
						</span>
					</button>
				)}
				<button
					onClick={onClick}
					disabled={saving}
					data-component="save-button"
					className={`rounded-2xl px-5 py-2 text-sm font-medium transition disabled:opacity-60 ${
						highCount > 0
							? "bg-rose-500 text-white hover:bg-rose-400 light:bg-rose-600 light:hover:bg-rose-500"
							: "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
					}`}
				>
					{saving ? t("settingsClient.saving") : t("settingsClient.save")}
				</button>
			</div>
			{expanded && count > 0 && (
				<div
					data-component="diff-table"
					role="region"
					aria-label="未保存的修改"
					className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02] light:bg-slate-50"
				>
					<table className="w-full text-xs">
						<thead className="border-b border-white/[0.08] bg-white/[0.02] text-left text-[11px] uppercase tracking-wide text-slate-400 light:bg-slate-100/70">
							<tr>
								<th className="px-3 py-2 font-medium">{t("settingsClient.diffTableField")}</th>
								<th className="px-3 py-2 font-medium">{t("settingsClient.diffTableOriginal")}</th>
								<th className="px-3 py-2 font-medium">{t("settingsClient.diffTableNew")}</th>
								<th className="px-3 py-2 font-medium">{t("settingsClient.diffTableRisk")}</th>
							</tr>
						</thead>
						<tbody>
							{pendingChanges.map((change) => (
								<tr
									key={change.key}
									data-pending-key={change.key}
									data-pending-risk={change.riskLevel}
									className="border-t border-white/[0.04] align-top"
								>
									<td className="px-3 py-2 font-mono text-[11px] text-white">{change.label}</td>
									<td className="px-3 py-2 text-slate-400 line-through">
										{renderDiffValue(change.oldValue, t)}
										</td>
										<td className="px-3 py-2 text-cyan-100 light:text-cyan-800">{renderDiffValue(change.newValue, t)}</td>
									<td className="px-3 py-2">
										<FieldRiskBadge level={change.riskLevel} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ── TR-014 M01b: HighRiskConfirmModal ──

/**
 * 提交保存前, 如果 pending changes 含 high 风险, 弹此 modal 强制二次确认。
 * 用 `<dialog>` 实现 (自带 backdrop + ESC 关闭), fallback 用 fixed 面板。
 */
function HighRiskConfirmModal({
	changes,
	onCancel,
	onConfirm,
}: {
	changes: PendingChange[];
	onCancel: () => void;
	onConfirm: () => void | Promise<void>;
}) {
	const { t } = useI18n();
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		// jsdom test env doesn't implement HTMLDialogElement.showModal
		if (typeof dialog.showModal === "function") {
			if (!dialog.open) dialog.showModal();
		} else if (!dialog.open) {
			dialog.open = true;
		}
		const handleClose = () => onCancel();
		dialog.addEventListener("close", handleClose);
		return () => dialog.removeEventListener("close", handleClose);
	}, [onCancel]);
	return (
		<dialog
			ref={dialogRef}
			aria-labelledby="high-risk-confirm-title"
			data-component="high-risk-confirm-modal"
			data-testid="high-risk-confirm-modal"
			className="rounded-2xl border border-white/[0.08] bg-slate-900/95 p-0 text-white shadow-2xl backdrop:bg-slate-950/70 light:backdrop:bg-slate-900/60"
		>
			<div className="w-[min(560px,90vw)] p-5">
				<h2 id="high-risk-confirm-title" className="text-base font-semibold text-rose-200 light:text-rose-700">
					{t("settingsClient.confirmHighRiskTitle")}
					</h2>
					<p className="mt-1 text-xs text-slate-400">
					{t("settingsClient.confirmHighRiskDescription").replace("{count}", String(changes.length))}
					</p>
				<ul className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
					{changes.map((change) => (
						<li
							key={change.key}
							className="rounded-lg border border-rose-400/20 bg-rose-500/[0.06] p-3 text-xs light:border-rose-200 light:bg-rose-50"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-[11px] text-white">{change.label}</span>
								<FieldRiskBadge level={change.riskLevel} />
							</div>
							<div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
								<div>
									<span className="text-slate-500">{t("settingsClient.confirmOriginal")}</span>
									<span className="text-slate-300 line-through">{renderDiffValue(change.oldValue, t, 40)}</span>
								</div>
								<div>
									<span className="text-slate-500">{t("settingsClient.confirmNew")}</span>
									<span className="text-rose-100 light:text-rose-800">{renderDiffValue(change.newValue, t, 40)}</span>
								</div>
							</div>
						</li>
					))}
				</ul>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={busy}
						data-action="cancel"
						className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50 light:text-slate-700 light:hover:bg-slate-50"
						>
						{t("settingsClient.confirmCancel")}
						</button>
						<button
						type="button"
						onClick={async () => {
							setBusy(true);
							try {
								await onConfirm();
							} finally {
								setBusy(false);
							}
						}}
						disabled={busy}
						data-action="confirm"
						className="rounded-lg bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50 light:bg-rose-600 light:hover:bg-rose-500"
						>
						{busy ? t("settingsClient.saving") : t("settingsClient.confirmSaveAction")}
						</button>
				</div>
			</div>
		</dialog>
	);
}
