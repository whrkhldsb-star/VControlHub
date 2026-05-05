import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
				<PageSkeleton />
			</div>
		</main>
	);
}
