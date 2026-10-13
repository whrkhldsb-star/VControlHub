import { ButtonLink } from "@/components/action-button";

/**
 * Previous/next pagination for server-rendered lists driven by `?page=N`.
 * Renders nothing when everything fits on the first page.
 */
export function LinkPagination({
	page,
	pageSize,
	total,
	hrefFor,
	labels,
}: {
	page: number;
	pageSize: number;
	total: number;
	hrefFor: (page: number) => string;
	labels: { label: string; range: string; previous: string; next: string };
}) {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	if (page <= 1 && pages <= 1) return null;
	return (
		<nav
			aria-label={labels.label}
			className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-secondary)] sm:px-5"
		>
			{page > 1 ? (
				<ButtonLink size="sm" variant="secondary" href={hrefFor(Math.min(page - 1, pages))}>
					{labels.previous}
				</ButtonLink>
			) : (
				<span />
			)}
			<span aria-live="polite" className="tabular-nums">
				{labels.range}
			</span>
			{page < pages ? (
				<ButtonLink size="sm" variant="secondary" href={hrefFor(page + 1)}>
					{labels.next}
				</ButtonLink>
			) : (
				<span />
			)}
		</nav>
	);
}
