/**
 * KeyValueList — label/value pairs such as host details, token metadata or
 * file properties, rendered as a semantic <dl>.
 *
 *   <KeyValueList columns={2} items={[
 *     { label: "主机", value: server.host, mono: true },
 *     { label: "系统", value: server.os },
 *   ]} />
 *
 * Empty values (null, undefined, "") show an em dash so rows never collapse.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

export type KeyValueItem = {
	label: ReactNode;
	value: ReactNode;
	/** Monospace value — hosts, paths, ids, hashes. */
	mono?: boolean;
	/** Let the value span the whole row (long paths, descriptions). */
	wide?: boolean;
	/** Stable React key when labels are not unique strings. */
	key?: string;
};

const COLUMNS = {
	1: "",
	2: "sm:grid-cols-2",
	3: "sm:grid-cols-2 lg:grid-cols-3",
} as const;

export function KeyValueList({
	items,
	columns = 1,
	layout = "stacked",
	className,
}: {
	items: KeyValueItem[];
	columns?: keyof typeof COLUMNS;
	/** stacked: label above value · inline: label left, value right. */
	layout?: "stacked" | "inline";
	className?: string;
}) {
	return (
		<dl className={cn("grid gap-x-6 gap-y-3", COLUMNS[columns], className)}>
			{items.map((item, index) => {
				const empty = item.value === null || item.value === undefined || item.value === "";
				return (
					<div
						key={item.key ?? (typeof item.label === "string" ? item.label : index)}
						className={cn(
							"min-w-0",
							layout === "inline" && "flex items-baseline justify-between gap-4",
							item.wide && columns > 1 && "sm:col-span-full",
						)}
					>
						<dt className="text-xs text-[var(--text-muted)]">{item.label}</dt>
						<dd
							className={cn(
								"min-w-0 text-[13.5px] text-[var(--text-primary)]",
								layout === "stacked" ? "mt-0.5 break-words" : "truncate text-right",
								item.mono && "ui-mono",
								empty && "text-[var(--text-muted)]",
							)}
						>
							{empty ? "—" : item.value}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
