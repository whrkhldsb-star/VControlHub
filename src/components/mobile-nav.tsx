"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";
import { mobileNavItems } from "./nav-items";

export function getMobileNavTabs() {
	return mobileNavItems;
}

export function MobileNav() {
	const pathname = usePathname();
	const { t } = useI18n();

	return (
		<nav
			aria-label={t("nav.mobile")}
			data-i18n-skip
			className="fixed bottom-0 left-0 right-0 z-50 overflow-hidden border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--modal-bg)_94%,transparent)] px-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_28px_color-mix(in_srgb,var(--text-primary)_8%,transparent)] backdrop-blur-xl light:bg-[color-mix(in_srgb,#ffffff_92%,var(--surface-subtle))] light:shadow-[0_-6px_20px_rgba(99,102,241,0.07)] md:hidden"
		>
			<div className="grid w-full grid-cols-[repeat(5,minmax(0,1fr))_auto] items-center gap-0.5">
				{mobileNavItems.map((tab) => {
					const active = tab.href === "/"
						? pathname === "/"
						: pathname === tab.href || pathname.startsWith(`${tab.href}/`);
					const label = t(tab.labelKey) === tab.labelKey ? tab.fallbackLabel : t(tab.labelKey);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={active ? "page" : undefined}
							className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition ${
								active
									? "bg-[var(--accent-bg)] font-medium text-[var(--accent)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
							}`}
						>
							<span className="[&>svg]:h-5 [&>svg]:w-5">{tab.icon}</span>
							<span className="text-[10px] leading-tight max-[420px]:sr-only">{label}</span>
						</Link>
					);
				})}
				<div className="ml-0 flex items-center gap-0.5 border-l border-[var(--border-subtle)] pl-1">
					<LanguageToggle compact />
					<ThemeToggle />
				</div>
			</div>
		</nav>
	);
}
