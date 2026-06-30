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
			aria-label="移动端底部导航"
			data-i18n-skip
			className="fixed bottom-0 left-0 right-0 z-50 overflow-x-auto border-t border-[var(--border)] bg-[var(--modal-bg)]/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden max-[360px]:px-1"
		>
			<div className="flex min-w-max items-center justify-around gap-1">
				{mobileNavItems.map((tab) => {
					const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
					const label = t(tab.labelKey) === tab.labelKey ? tab.fallbackLabel : t(tab.labelKey);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							className={`flex min-w-14 flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition ${
								active ?"text-cyan-400" :"text-slate-500"
							}`}
						>
							<span className="[&>svg]:h-5 [&>svg]:w-5">{tab.icon}</span>
							<span className="text-[10px] leading-tight">{label}</span>
						</Link>
					);
				})}
				<div className="ml-1 flex items-center gap-1 border-l border-white/[0.06] pl-2">
					<LanguageToggle compact />
					<ThemeToggle />
				</div>
			</div>
		</nav>
	);
}
