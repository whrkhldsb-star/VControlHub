/**
 * Disclosure — a section that stays folded until it is needed (advanced
 * settings, migration tools, raw commands). A native <details>, so it works
 * in server components and without JavaScript.
 *
 *   <Disclosure title="迁移工具" description="导出备份并在新服务器上恢复">…</Disclosure>
 *
 * `variant="card"` is a page-level block whose title is an <h2>;
 * `variant="inset"` nests inside a card or list row.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";
import { IconChevronDown } from "../nav-icons";

export function Disclosure({
	title,
	description,
	children,
	defaultOpen = false,
	variant = "card",
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	defaultOpen?: boolean;
	variant?: "card" | "inset";
	className?: string;
}) {
	const compact = variant === "inset";
	return (
		<details
			data-disclosure
			data-card={compact ? undefined : ""}
			data-inset={compact ? "" : undefined}
			open={defaultOpen || undefined}
			className={cn("group p-0", className)}
		>
			{/* summary allows a heading plus phrasing content, so the parts sit
			    directly in it on a two-column grid instead of inside a wrapper. */}
			<summary
				className={cn(
					"grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[inherit] transition-colors hover:bg-[var(--surface-hover)] [&::-webkit-details-marker]:hidden",
					compact ? "px-3 py-2" : "px-4 py-3 sm:px-5",
				)}
			>
				{compact ? (
					<span className="col-start-1 text-xs font-medium text-[var(--text-primary)]">{title}</span>
				) : (
					<h2 className="col-start-1 text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
				)}
				{description ? <span className="col-start-1 mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{description}</span> : null}
				<IconChevronDown
					size={compact ? 14 : 16}
					className="col-start-2 row-span-2 row-start-1 text-[var(--text-muted)] transition-transform duration-150 group-open:rotate-180"
				/>
			</summary>
			<div className={cn("border-t border-[var(--border-subtle)]", compact ? "px-3 py-2.5" : "px-4 py-4 sm:px-5")}>{children}</div>
		</details>
	);
}
