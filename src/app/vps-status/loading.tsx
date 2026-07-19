export default function Loading() {
	return (
		<div className="space-y-4 p-4" aria-busy="true">
			<div className="h-8 w-48 animate-pulse rounded-lg bg-[var(--surface-elevated)]" />
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				{Array.from({ length: 5 }).map((_, i) => (
					<div key={i} className="h-20 animate-pulse rounded-2xl bg-[var(--surface-elevated)]" />
				))}
			</div>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="h-56 animate-pulse rounded-2xl bg-[var(--surface-elevated)]" />
				))}
			</div>
		</div>
	);
}
