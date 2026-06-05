export default function Loading() {
	return (
		<div className="animate-pulse space-y-6 p-6">
			<div className="flex items-end justify-between">
				<div className="space-y-2">
					<div className="h-3 w-24 rounded bg-slate-700/50 light:bg-slate-200/50" />
					<div className="h-7 w-32 rounded bg-slate-700/50 light:bg-slate-200/50" />
				</div>
				<div className="h-10 w-32 rounded-lg bg-slate-700/50 light:bg-slate-200/50" />
			</div>
			<div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{Array.from({ length: 10 }).map((_, i) => (
					<div key={i} className="aspect-square rounded-xl bg-slate-700/50 light:bg-slate-200/50" />
				))}
			</div>
		</div>
	);
}
