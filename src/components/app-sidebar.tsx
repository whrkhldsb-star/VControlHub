"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "./sign-out-button";
import { ChangePasswordModal } from "./change-password-modal";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";
import { getAppName, getPublicLabel } from "@/lib/branding";
import { useI18n } from "@/lib/i18n/use-locale";
import { IconExternal, IconKey, mainNavItems, systemNavItems } from "./nav-items";

interface QuickServiceLink {
	slug: string;
	name: string;
	icon: string;
	path: string;
}

function SidebarControls() {
	const { t } = useI18n();
	const openGlobalSearch = () => {
		window.dispatchEvent(new Event("vcontrolhub:open-global-search"));
	};

	return (
		<div className="ml-auto flex items-center gap-1">
			<button
				type="button"
				onClick={openGlobalSearch}
				className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-900"
				aria-label={t("search.dialog") === "search.dialog" ? "全局搜索" : t("search.dialog")}
				aria-keyshortcuts="Control+K Meta+K"
			>
				<span aria-hidden="true">⌕</span>
			</button>
			<LanguageToggle />
			<ThemeToggle />
			<NotificationBell />
		</div>
	);
}

export function AppSidebar({ username, quickServices = [] }: { username?: string; quickServices?: QuickServiceLink[] }) {
	const pathname = usePathname();
	const { t } = useI18n();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [passwordModalOpen, setPasswordModalOpen] = useState(false);
	const shouldRenderSidebar = Boolean(username);
	const iconInitial = username?.trim().charAt(0).toUpperCase() ?? "";

	if (!shouldRenderSidebar) return null;

	const isActive = (href: string) => {
		if (href === "/") return pathname === "/";
		return pathname.startsWith(href);
	};

	const renderNavLink = (item: (typeof mainNavItems)[number]) => {
		const active = isActive(item.href);
		return (
			<Link
				key={item.href}
				href={item.href}
				onClick={() => setMobileOpen(false)}
				className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-all duration-150 ${
					active
						? "bg-cyan-400/[0.10] text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.16)] font-medium light:bg-cyan-50 light:text-cyan-800 light:shadow-[inset_0_0_0_1px_rgba(14,116,144,0.16)]"
						: "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 light:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-950"
				}`}
			>
				<span className={active ? "text-cyan-400 light:text-cyan-700" : "text-slate-500 light:text-slate-500"}>{item.icon}</span>
				<span className="min-w-0 flex-1 truncate" title={t(item.labelKey) === item.labelKey ? item.fallbackLabel : t(item.labelKey)}>{t(item.labelKey) === item.labelKey ? item.fallbackLabel : t(item.labelKey)}</span>
			</Link>
		);
	};

	const nav = (
		<nav className="flex h-full flex-col" data-i18n-skip>
			<div className="border-b border-white/[0.06] px-5 py-5 light:border-slate-200">
				<div className="flex items-center gap-2.5">
					<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.20)] light:bg-cyan-50 light:text-cyan-700 light:shadow-[inset_0_0_0_1px_rgba(14,116,144,0.14)]">
						<svg className="h-4.5 w-4.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.05 4.646 12.2a1 1 0 00.476 1.006l4.5 2.706a1 1 0 001.056 0l4.5-2.706a1 1 0 00.476-1.006L14.95 8.05l2.644-1.228a1 1 0 000-1.84l-7-3zM10 4.08l5.106 2.19L10 8.49 4.894 6.27 10 4.08z" /></svg>
					</div>
					<div className="min-w-0">
						<div className="truncate text-base font-semibold tracking-tight text-white light:text-slate-950">{getAppName()}</div>
						<p className="mt-0.5 truncate text-[11px] leading-none text-slate-500 light:text-slate-500">{getPublicLabel()}</p>
					</div>
				</div>
			</div>

			<div className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4">
				{mainNavItems.map(renderNavLink)}

				<div className="px-3.5 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600 light:text-slate-400">
					{t("nav.system") === "nav.system" ? "系统管理" : t("nav.system")}
				</div>
				{systemNavItems.map(renderNavLink)}

				{quickServices.length > 0 && (
					<>
						<div className="px-3.5 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600 light:text-slate-400">
							{t("nav.quickservice") === "nav.quickservice" ? "快捷服务" : t("nav.quickservice")}
						</div>
						{quickServices.map((item) => (
							<a
								key={item.slug}
								href={item.path}
								target="_blank"
								rel="noopener noreferrer"
								onClick={() => setMobileOpen(false)}
								className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm text-slate-400 transition-all duration-150 hover:bg-white/[0.04] hover:text-slate-200 light:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-950"
							>
								<span className="shrink-0 text-[18px] leading-none">{item.icon}</span>
								<span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
								<IconExternal />
							</a>
						))}
					</>
				)}
			</div>

			<div className="space-y-1 border-t border-white/[0.06] px-3 py-3 light:border-slate-200">
				<div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 light:text-slate-600">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold uppercase text-cyan-400 light:bg-cyan-50 light:text-cyan-700">
						{iconInitial}
					</div>
					<span className="min-w-0 flex-1 truncate" title={username}>{username}</span>
					<SidebarControls />
				</div>
				<button
					onClick={() => {
						setPasswordModalOpen(true);
						setMobileOpen(false);
					}}
					className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2 text-sm text-slate-400 transition-all duration-150 hover:bg-white/[0.04] hover:text-slate-200 light:hover:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-950"
				>
					<IconKey />
					<span>{t("auth.change-password") === "auth.change-password" ? "修改密码" : t("auth.change-password")}</span>
				</button>
				<div className="px-2 py-1">
					<SignOutButton />
				</div>
			</div>
		</nav>
	);

	return (
		<>
			<button
				onClick={() => setMobileOpen(true)}
				className="fixed left-4 top-4 z-50 rounded-lg border border-white/10 bg-slate-950/90 p-2.5 text-slate-200 backdrop-blur transition hover:bg-white/10 light:border-slate-200 light:bg-white/95 light:text-slate-800 light:hover:bg-slate-100 lg:hidden"
				aria-label="打开导航菜单"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>

			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
					onClick={() => setMobileOpen(false)}
				/>
			)}

			<aside
				className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,86vw)] transform border-r border-white/[0.06] bg-slate-950 transition-transform duration-200 light:border-slate-200 light:bg-white lg:hidden ${
					mobileOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				{nav}
			</aside>

			<aside className="hidden h-screen w-72 shrink-0 border-r border-white/[0.06] bg-[#0a0e1a] light:border-slate-200 light:bg-white lg:sticky lg:top-0 lg:flex">
				{nav}
			</aside>

			<ChangePasswordModal
				open={passwordModalOpen}
				onClose={() => setPasswordModalOpen(false)}
			/>
		</>
	);
}
