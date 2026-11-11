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
	createContext,
	type ReactNode,
	useActionState,
	useContext,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import {
	batchReviewCommandAction,
	type BatchReviewActionState,
} from "./actions";
import { ActionButton } from "@/components/action-button";

type BatchReviewToolbarProps = {
	pendingIds: string[];
	children: ReactNode;
};

/**
 * Selection shared with the cards. The toolbar used to look for `data-id` on
 * its direct children, but the cards sit inside <PaginatedList>, so no row ever
 * got a checkbox and only "select all" worked (A6-02). Cards render
 * <BatchSelectCheckbox id>, which draws nothing outside a toolbar.
 */
const BatchSelectionContext = createContext<{ selected: Set<string>; toggle: (id: string) => void; pendingIds: string[] } | null>(null);

export function BatchSelectCheckbox({ id }: { id: string }) {
	const { t } = useI18n();
	const selection = useContext(BatchSelectionContext);
	if (!selection || !selection.pendingIds.includes(id)) return null;
	return (
		<label
			className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-[var(--modal-bg)] hover:bg-[var(--surface-elevated)]"
			aria-label={t("requestsPage.batch.selectOneAria")}
		>
			<input
				type="checkbox"
				className="h-3.5 w-3.5 accent-[var(--color-action)]"
				checked={selection.selected.has(id)}
				onChange={() => selection.toggle(id)}
			/>
		</label>
	);
}

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
		const timer = window.setTimeout(() => {
			setSelected((prev) => {
				const next = new Set<string>();
				for (const id of prev) if (pendingIds.includes(id)) next.add(id);
				return next.size === prev.size ? prev : next;
			});
		}, 0);
		return () => window.clearTimeout(timer);
	}, [pendingIds]);

	const [state, formAction, isPending] = useActionState(
		batchReviewCommandAction,
		initialState,
	);

	// Clear the selection and the comment after each reviewed batch. Keyed on the answer itself: on its
	// sentence, a second batch that ended with the same words ("2 approved") left both in place.
	useEffect(() => {
		if (!state.success || state.error) return;
		const timer = window.setTimeout(() => {
			setSelected(new Set());
			setComment("");
		}, 0);
		return () => window.clearTimeout(timer);
	}, [state]);

	// Why the requests that were not reviewed were refused: the action answers per request, and only the
	// count was shown ("1 approved, 1 failed").
	const refusals = useMemo(
		() => Array.from(new Set(Object.values(state.results ?? {}).filter((outcome) => outcome !== "ok"))),
		[state.results],
	);

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

	const selectionContext = useMemo(() => ({ selected, toggle: toggleOne, pendingIds }), [selected, pendingIds]);

	if (pendingIds.length === 0) {
		return <>{children}</>;
	}

	return (
		<div className="space-y-3" data-batch-review>
			<div data-tile className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
				<label className="inline-flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						className="h-4 w-4 accent-[var(--color-action)]"
						checked={allSelected}
						onChange={toggleAll}
						aria-label={t("requestsPage.batch.selectAllAria")}
					/>
					<span className="text-[var(--text-secondary)]">
						{t("requestsPage.batch.selectAll", { count: pendingIds.length })}
					</span>
				</label>
				{someSelected && (
					<span className="text-[var(--color-action-text)]">{t("requestsPage.batch.selectedCount", { count: selected.size })}</span>
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
				{refusals.length > 0 && (
					<ul className="basis-full space-y-0.5 text-xs text-[var(--danger)]" role="alert">
						{refusals.map((reason) => <li key={reason}>{reason}</li>)}
					</ul>
				)}
			</div>

			<BatchSelectionContext.Provider value={selectionContext}>{children}</BatchSelectionContext.Provider>

			{someSelected && (
				<form
					action={formAction}
					data-action-bar=""
					className="sticky bottom-3 z-20 flex-col items-stretch sm:flex-row sm:items-center"
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
						// Enter in a text box submits the form with its first button, which is "approve": a comment typed
						// and confirmed with Enter approved every selected command.
						onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
						placeholder={t("requestsPage.batch.commentPlaceholder")}
						className={cn(UI_INPUT, "flex-1")}
					/>
					<ActionButton variant="success"
						type="submit"
						name="decision"
						value="approve"
						disabled={isPending}>
						{isPending ? t("requestsPage.batch.pending") : t("requestsPage.batch.approve", { count: selected.size })}
					</ActionButton>
					<ActionButton variant="danger"
						type="submit"
						name="decision"
						value="reject"
						disabled={isPending}>
						{isPending ? t("requestsPage.batch.pending") : t("requestsPage.batch.reject", { count: selected.size })}
					</ActionButton>
				</form>
			)}
		</div>
	);
}
