"use client";

import Link from "next/link";

import { mainNavGroups, systemNavGroup } from "@/components/nav-items";
import { Disclosure } from "@/components/ui/disclosure";
import { useI18n } from "@/lib/i18n/use-locale";

/**
 * Every page this account can open, by sidebar group, each with the one sentence that says what it is for — so a
 * newcomer can scan the whole platform in a few seconds. Folded by default: people who know the console never
 * need it open. The server decides which pages are visible (the same rule as the sidebar).
 */
export function DashboardFeatureMap({ visibleHrefs }: { visibleHrefs: readonly string[] }) {
	const { t } = useI18n();
	const visible = new Set(visibleHrefs);
	const groups = [...mainNavGroups, systemNavGroup]
		.map((group) => ({ ...group, items: group.items.filter((item) => visible.has(item.href)) }))
		.filter((group) => group.items.length > 0);
	if (groups.length === 0) return null;
	const pageCount = groups.reduce((total, group) => total + group.items.length, 0);

	return (
		<Disclosure
			title={t("dashboard.featureMap.title")}
			description={t("dashboard.featureMap.description", { count: pageCount })}
			className="mt-6"
		>
			<div className="grid gap-x-6 gap-y-5 border-t border-[var(--border-subtle)] px-4 py-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
				{groups.map((group) => (
					<section key={group.id} aria-labelledby={`feature-map-${group.id}`} className="min-w-0">
						<h3 id={`feature-map-${group.id}`} className="ui-title-caption mb-1.5">{t(group.labelKey)}</h3>
						<ul className="space-y-1">
							{group.items.map((item) => (
								<li key={item.href}>
									<Link
										href={item.href}
										className="group flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
									>
										<span aria-hidden className="mt-0.5 flex shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)] [&>svg]:h-4 [&>svg]:w-4">
											{item.icon}
										</span>
										<span className="min-w-0">
											<span className="block text-sm font-medium text-[var(--text-primary)]">{t(item.labelKey)}</span>
											<span className="block text-xs leading-5 text-[var(--text-muted)]">{t(item.descKey)}</span>
										</span>
									</Link>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</Disclosure>
	);
}
