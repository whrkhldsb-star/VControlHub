"use client";

/**
 * Account menu at the foot of the sidebar: who is signed in, the customer,
 * personal settings, appearance and sign-out — everything that used to be a
 * stack of separate rows under the navigation.
 */
import { useId, useRef, useState } from "react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { useOptionalTheme } from "@/lib/theme/use-theme";
import { cn } from "@/lib/ui/cn";
import { ChangePasswordModal } from "./change-password-modal";
import { SignOutButton } from "./sign-out-button";
import { useDismiss } from "./ui/menu";
import {
	IconChevronsUpDown,
	IconKey,
	IconKeyboard,
	IconMoon,
	IconShield,
	IconSliders,
	IconSun,
} from "./nav-icons";

export const OPEN_SHORTCUTS_EVENT = "vcontrolhub:open-shortcuts";

function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string; icon?: React.ReactNode }[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
			<span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
			<div role="radiogroup" aria-label={label} className="flex rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-0.5">
				{options.map((option) => {
					const selected = option.value === value;
					return (
						<button
							key={option.value}
							type="button"
							role="radio"
							aria-checked={selected}
							onClick={() => onChange(option.value)}
							className={cn(
								"flex h-6 items-center gap-1 rounded px-2 text-xs transition",
								selected
									? "bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
							)}
						>
							{option.icon}
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function UserMenu({
	username,
	compact = false,
	onNavigate,
}: {
	username: string;
	compact?: boolean;
	onNavigate?: () => void;
}) {
	const { t, locale, setLocale } = useI18n();
	const { theme, setTheme } = useOptionalTheme();
	const [open, setOpen] = useState(false);
	const [passwordOpen, setPasswordOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelId = useId();
	const initial = username.trim().charAt(0).toUpperCase();

	useDismiss({
		open,
		refs: [rootRef],
		onDismiss: (reason) => {
			setOpen(false);
			if (reason === "escape") triggerRef.current?.focus();
		},
	});

	const close = () => {
		setOpen(false);
		onNavigate?.();
	};

	return (
		<div ref={rootRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={panelId}
				aria-label={t("shell.user.menu")}
				title={compact ? username : undefined}
				className={cn(
					"flex w-full min-w-0 items-center gap-2.5 rounded-md text-left transition hover:bg-[var(--sidebar-hover)]",
					compact ? "mx-auto h-9 w-9 justify-center" : "px-2 py-1.5",
					open && "bg-[var(--sidebar-hover)]",
				)}
			>
				<span
					aria-hidden="true"
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-xs font-semibold uppercase text-[var(--accent)] ring-1 ring-inset ring-[var(--accent-border)]"
				>
					{initial}
				</span>
				{compact ? null : (
					<>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium text-[var(--text-primary)]" title={username}>
								{username}
							</span>
						</span>
						<IconChevronsUpDown size={14} className="shrink-0 text-[var(--text-muted)]" />
					</>
				)}
			</button>

			{open ? (
				<div
					id={panelId}
					aria-label={t("shell.user.menu")}
					data-popover
						className={cn("absolute w-64", compact ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2")}
				>
					<div className="px-2.5 pb-2 pt-1.5">
						<div className="text-[11px] text-[var(--text-muted)]">{t("shell.user.signedInAs")}</div>
						<div className="truncate text-sm font-semibold text-[var(--text-primary)]">{username}</div>
					</div>
					<div data-menu-separator />
					<Link href="/account/security" onClick={close} data-menu-item>
						<IconShield size={16} />
						{t("auth.account-security")}
					</Link>
					<button
						type="button"
						data-menu-item
						onClick={() => {
							setPasswordOpen(true);
							close();
						}}
					>
						<IconKey size={16} />
						{t("auth.change-password")}
					</button>
					<Link href="/settings#personal-preferences" onClick={close} data-menu-item>
						<IconSliders size={16} />
						{t("shell.user.preferences")}
					</Link>
					<button
						type="button"
						data-menu-item
						onClick={() => {
							close();
							window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
						}}
					>
						<IconKeyboard size={16} />
						{t("shell.user.shortcuts")}
						<span className="ml-auto ui-kbd">?</span>
					</button>
					<div data-menu-separator />
					<Segmented
						label={t("shell.user.appearance")}
						value={theme}
						onChange={setTheme}
						options={[
							{ value: "dark", label: t("shell.user.themeDark"), icon: <IconMoon size={12} /> },
							{ value: "light", label: t("shell.user.themeLight"), icon: <IconSun size={12} /> },
						]}
					/>
					<Segmented
						label={t("shell.user.language")}
						value={locale}
						onChange={setLocale}
						options={[
							{ value: "zh", label: "中文" },
							{ value: "en", label: "EN" },
						]}
					/>
					<div data-menu-separator />
					<SignOutButton />
				</div>
			) : null}

			{passwordOpen ? <ChangePasswordModal open onClose={() => setPasswordOpen(false)} /> : null}
		</div>
	);
}
