/* ── Skeleton / Loading Components ─────────────────────────── */

/**
 * Static bar / chip placeholder.  Uses Q-layer-mapped `bg-slate-700/20`
 * so it has a visible tint in both dark and light themes; an animated
 * `data-skeleton` overlay drives the shimmer via globals.css.
 */
export function SkeletonLine({ className }: { className?: string }) {
	return <div className={`animate-pulse rounded-lg bg-slate-700/20 ${className ?? "h-4 w-3/4"}`} />;
}

export function SkeletonCard({ className }: { className?: string }) {
	return (
		<div className={`animate-pulse rounded-xl border border-slate-700/20 bg-slate-700/10 p-5 space-y-3 ${className ?? ""}`}>
			<div className="h-4 w-1/3 rounded bg-slate-700/20" />
			<div className="h-8 w-2/3 rounded bg-slate-700/20" />
			<div className="h-3 w-1/2 rounded bg-slate-700/10" />
		</div>
	);
}

export function SkeletonList({ count = 3 }: { count?: number }) {
	return (
		<div className="space-y-3">
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="animate-pulse rounded-xl border border-slate-700/20 bg-slate-700/10 p-4 space-y-2.5">
					<div className="h-4 w-2/3 rounded bg-slate-700/20" />
					<div className="h-3 w-1/2 rounded bg-slate-700/10" />
					<div className="h-3 w-1/3 rounded bg-slate-700/10" />
				</div>
			))}
		</div>
	);
}

export function PageSkeleton() {
	return (
		<div className="space-y-6" data-testid="page-skeleton">
			<div className="space-y-2">
				<div className="animate-pulse h-8 w-48 rounded bg-slate-700/20" />
				<div className="animate-pulse h-4 w-72 rounded bg-slate-700/10" />
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<SkeletonCard key={i} />
				))}
			</div>
			<div className="grid gap-6 lg:grid-cols-2">
				<SkeletonList count={4} />
				<SkeletonList count={4} />
			</div>
		</div>
	);
}
