import type { ReactNode } from "react";

import { ButtonLink } from "./action-button";
import { Disclosure } from "./ui/disclosure";

export type PageGuideLink = {
	href: string;
	label: string;
};

/**
 * Compact collapsible "how this works" guide for multi-step or sibling-adjacent
 * pages. Built on `Disclosure variant="inset"` so it stays quiet once folded
 * and works in server or client components without JavaScript.
 */
export function PageGuide({
	title,
	summary,
	steps,
	links,
	defaultOpen = false,
	className,
}: {
	title: ReactNode;
	summary?: ReactNode;
	steps?: readonly ReactNode[];
	links?: readonly PageGuideLink[];
	defaultOpen?: boolean;
	className?: string;
}) {
	const hasSteps = Boolean(steps && steps.length > 0);
	const hasLinks = Boolean(links && links.length > 0);
	return (
		<Disclosure
			title={title}
			description={summary}
			defaultOpen={defaultOpen}
			variant="inset"
			className={className}
		>
			<div className="space-y-3 text-xs leading-5 text-[var(--text-secondary)]">
				{hasSteps ? (
					<ol className="list-decimal space-y-1.5 pl-4 marker:text-[var(--text-muted)]">
						{steps!.map((step, index) => (
							<li key={index}>{step}</li>
						))}
					</ol>
				) : null}
				{hasLinks ? (
					<div className="flex flex-wrap items-center gap-2 pt-0.5">
						{links!.map((link) => (
							<ButtonLink key={link.href} href={link.href} size="xs" variant="secondary">
								{link.label}
							</ButtonLink>
						))}
					</div>
				) : null}
			</div>
		</Disclosure>
	);
}
