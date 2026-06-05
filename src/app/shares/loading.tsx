export default function Loading() {
	return (
		<div className="animate-pulse space-y-6 p-6">
			{/* Header skeleton */}
			<div className="flex items-end justify-between">
				<div className="space-y-2">
					<div className="h-3 w-24 rounded bg-slate-700/50 light:bg-slate-200/50" />
					<div className="h-7 w-48 rounded bg-slate-700/50 light:bg-slate-200/50" />
				</div>
				<div className="h-9 w-28 rounded-lg bg-slate-700/50 light:bg-slate-200/50" />
			</div>
			{/* Content skeleton */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="rounded-xl border border-slate-700/50 light:border-slate-200/50 bg-slate-800/50 light:bg-slate-100/50 p-4 space-y-3">
						<div className="h-4 w-3/4 rounded bg-slate-700/50 light:bg-slate-200/50" />
						<div className="h-3 w-1/2 rounded bg-slate-700/50 light:bg-slate-200/50" />
						<div className="h-3 w-2/3 rounded bg-slate-700/50 light:bg-slate-200/50" />
					</div>
				))}
			</div>
		</div>
	);
}
