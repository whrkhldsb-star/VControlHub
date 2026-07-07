"use client";

/**
 * Batch approval toolbar for the /requests page.
 *
 * Wraps the pending command-request list with checkboxes + an action bar.
 * Strategy: render children inside an unstyled <ul> and inject a per-row
 * checkbox via React.Children.map (children must be <li> with `data-id`).
 *
 * Keeping the wrapper presentation-only lets the existing server-rendered
 * card markup stay unchanged — we only add (a) selection state, (b) a
 * fixed-bottom action bar when ≥1 item is selected, (c) calls to the
 * batchReviewCommandAction server action.
 */

import {
	Children,
	cloneElement,
	type ReactElement,
	type ReactNode,
	useActionState,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";

import { useI18n } from "@/lib/i18n/use-locale";

import {
	batchReviewCommandAction,
	type BatchReviewActionState,
} from "./actions";

type BatchReviewToolbarProps = {
	pendingIds: string[];
	children: ReactNode;
};

const initialState: BatchReviewActionState = {};

export function BatchReviewToolbar({
	pendingIds,
	children,
}: BatchReviewToolbarProps) {
	const { t } = useI18n();
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [comment, setComment] = useState("");
	const commentId = useId();

	const allSelected = useMemo(
		() => pendingIds.length > 0 && pendingIds.every((id) => selected.has(id)),
		[pendingIds, selected],
	);
	const someSelected = selected.size > 0;

	// Reset selection if the underlying pending list shrinks (e.g. after revalidate)
	useEffect(() => {
		setSelected((prev) => {
			const next = new Set<string>();
			for (const id of prev) if (pendingIds.includes(id)) next.add(id);
			return next.size === prev.size ? prev : next;
		});
	}, [pendingIds]);

	const [state, formAction, isPending] = useActionState(
		batchReviewCommandAction,
		initialState,
	);

	// Clear selection on successful batch
	useEffect(() => {
		if (state.success && !state.error) {
			setSelected(new Set());
			setComment("");
		}
	}, [state.success, state.error]);

	function toggleAll() {
		setSelected(allSelected ? new Set() : new Set(pendingIds));
	}
	function toggleOne(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// Inject a checkbox at the top-left of each child card. Children must be
	// ReactElement with a `data-id` prop (set by the page server component).
	const decoratedChildren = Children.map(children, (child) => {
		if (!child || typeof child !== "object" || !("props" in child)) return child;
		const el = child as ReactElement<{ "data-id"?: string }>;
		const id = el.props["data-id"];
		if (!id || !pendingIds.includes(id)) return child;
		return (
			<div className="relative">
				<label
					className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-[var(--modal-bg)] hover:bg-[var(--surface)]"
					aria-label={`Select ${id}`}
				>
					<input
						type="checkbox"
						className="h-3.5 w-3.5 accent-[var(--color-action)]"
						checked={selected.has(id)}
						onChange={() => toggleOne(id)}
					/>
				</label>
				<div className="pl-10">{el}</div>
			</div>
		);
	});

	if (pendingIds.length === 0) {
		return <>{children}</>;
	}

	return (
		<div className="space-y-3" data-batch-review>
			<div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm">
				<label className="inline-flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						className="h-4 w-4 accent-[var(--color-action)]"
						checked={allSelected}
						onChange={toggleAll}
						aria-label={t("requestsPage.batch.selectAllAria")}
					/>
					<span className="text-[var(--text-secondary)]">
						{t("requestsPage.batch.selectAll").replace("{count}", String(pendingIds.length))}
					</span>
				</label>
				{someSelected && (
					<span className="text-[var(--color-action)]">{t("requestsPage.batch.selectedCount").replace("{count}", String(selected.size))}</span>
				)}
				{state.success && (
					<span data-tone="emerald" className="text-[var(--success)]">
						{state.success}
					</span>
				)}
				{state.error && (
					<span data-tone="rose" className="text-[var(--danger)]">
						{state.error}
					</span>
				)}
			</div>

			{decoratedChildren}

			{someSelected && (
				<form
					action={formAction}
					className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-xl border border-[var(--color-action-border)]/30 bg-[var(--modal-bg)] p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:gap-3"
					aria-label={t("requestsPage.batch.toolbarAria")}
				>
					{Array.from(selected).map((id) => (
						<input key={id} type="hidden" name="commandRequestId" value={id} />
					))}
					<label htmlFor={commentId} className="sr-only">
						{t("requestsPage.batch.commentLabel")}
					</label>
					<input
						id={commentId}
						type="text"
						name="comment"
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						placeholder={t("requestsPage.batch.commentPlaceholder")}
						className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-action-border)]/40"
					/>
					<button
						type="submit"
						name="decision"
						value="approve"
						disabled={isPending}
						className="rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-medium text-[var(--color-action-fg)] transition hover:bg-[var(--success-bg)] hover:text-[var(--success)] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isPending ? t("requestsPage.batch.pending") : t("requestsPage.batch.approve").replace("{count}", String(selected.size))}
					</button>
					<button
						type="submit"
						name="decision"
						value="reject"
						disabled={isPending}
						className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isPending ? t("requestsPage.batch.pending") : t("requestsPage.batch.reject").replace("{count}", String(selected.size))}
					</button>
				</form>
			)}
		</div>
	);
}
