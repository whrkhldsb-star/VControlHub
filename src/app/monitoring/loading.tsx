import { PageSkeleton } from "@/components/skeleton";
import { PageShell } from "@/components/page-shell";

export default function Loading() {
	return (
		<PageShell maxW="max-w-6xl">
			<PageSkeleton />
		</PageShell>
	);
}
