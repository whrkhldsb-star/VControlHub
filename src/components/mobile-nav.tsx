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
			className="fixed bottom-0 left-0 right-0 z-50 overflow-hidden border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--modal-bg)_92%,transparent)] px-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl md:hidden"
		>
			<div className="grid w-full grid-cols-[repeat(5,minmax(0,1fr))_auto] items-center gap-0.5">
				{mobileNavItems.map((tab) => {
					const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
					const label = t(tab.labelKey) === tab.labelKey ? tab.fallbackLabel : t(tab.labelKey);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={active ? "page" : undefined}
							className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition ${
								active
									? "bg-[var(--color-action-bg)] text-[var(--color-action)]"
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
