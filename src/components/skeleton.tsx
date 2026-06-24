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

/** /servers — 服务器卡片列表骨架 */
export function ServersPageSkeleton() {
	return (
		<div className="space-y-6" data-testid="servers-skeleton">
			{/* header */}
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<div className="animate-pulse h-8 w-32 rounded bg-slate-700/20" />
					<div className="animate-pulse h-4 w-56 rounded bg-slate-700/10" />
				</div>
				<div className="flex gap-2">
					{Array.from({ length: 3 }).map((_, i) => (
						<div key={i} className="animate-pulse h-9 w-24 rounded-xl bg-slate-700/20" />
					))}
				</div>
			</div>
			{/* stat pills */}
			<div className="flex gap-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="animate-pulse h-8 w-28 rounded-full bg-slate-700/20" />
				))}
			</div>
			{/* server cards */}
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="animate-pulse rounded-2xl border border-slate-700/20 bg-slate-700/10 p-4 space-y-3">
						<div className="flex items-center justify-between">
							<div className="h-5 w-32 rounded bg-slate-700/20" />
							<div className="h-5 w-16 rounded-full bg-slate-700/20" />
						</div>
						<div className="space-y-1.5">
							{Array.from({ length: 3 }).map((_, j) => (
								<div key={j} className="flex items-center gap-2">
									<div className="h-3 w-16 rounded bg-slate-700/20" />
									<div className="h-2 flex-1 rounded-full bg-slate-700/20" />
									<div className="h-3 w-8 rounded bg-slate-700/20" />
								</div>
							))}
						</div>
						<div className="flex gap-2 pt-1">
							<div className="h-8 w-20 rounded-lg bg-slate-700/20" />
							<div className="h-8 w-20 rounded-lg bg-slate-700/20" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

/** /health — 健康看板骨架 */
export function HealthPageSkeleton() {
	return (
		<div className="space-y-6" data-testid="health-skeleton">
			<div className="space-y-2">
				<div className="animate-pulse h-8 w-36 rounded bg-slate-700/20" />
				<div className="animate-pulse h-4 w-64 rounded bg-slate-700/10" />
			</div>
			{/* stat cards row */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="animate-pulse rounded-xl border border-slate-700/20 bg-slate-700/10 p-4 space-y-2">
						<div className="h-3 w-20 rounded bg-slate-700/20" />
						<div className="h-8 w-12 rounded bg-slate-700/20" />
					</div>
				))}
			</div>
			{/* server health rows */}
			<div className="space-y-3">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="animate-pulse rounded-2xl border border-slate-700/20 bg-slate-700/10 p-4">
						<div className="flex items-center justify-between mb-3">
							<div className="h-5 w-28 rounded bg-slate-700/20" />
							<div className="h-5 w-16 rounded-full bg-slate-700/20" />
						</div>
						<div className="grid grid-cols-3 gap-3">
							{Array.from({ length: 3 }).map((_, j) => (
								<div key={j} className="space-y-1">
									<div className="flex justify-between">
										<div className="h-3 w-10 rounded bg-slate-700/20" />
										<div className="h-3 w-8 rounded bg-slate-700/20" />
									</div>
									<div className="h-1.5 w-full rounded-full bg-slate-700/20" />
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

/** /files — 文件管理双栏骨架 */
export function FilesPageSkeleton() {
	return (
		<div className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]" data-testid="files-skeleton">
			{/* sidebar skeleton */}
			<div className="hidden xl:block animate-pulse rounded-3xl border border-slate-700/20 bg-slate-700/10 p-6 space-y-4">
				<div className="h-5 w-24 rounded bg-slate-700/20" />
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="flex items-center gap-2">
						<div className="h-3 w-3 rounded bg-slate-700/20" />
						<div className="h-3 w-32 rounded bg-slate-700/20" />
					</div>
				))}
			</div>
			{/* main area skeleton */}
			<div className="space-y-4">
				<div className="animate-pulse rounded-3xl border border-slate-700/20 bg-slate-700/10 p-6 space-y-3">
					<div className="h-6 w-40 rounded bg-slate-700/20" />
					<div className="h-9 w-full rounded-xl bg-slate-700/20" />
				</div>
				<div className="grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
					{Array.from({ length: 12 }).map((_, i) => (
						<div key={i} className="animate-pulse rounded-xl border border-slate-700/20 bg-slate-700/10 p-3 space-y-2">
							<div className="h-10 w-full rounded bg-slate-700/20" />
							<div className="h-3 w-full rounded bg-slate-700/20" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

