import { PageSkeleton } from "@/components/skeleton";
import { PageShell } from "@/components/page-shell";

export default function Loading() {
	return (
		<PageShell>
			<PageSkeleton />
		</PageShell>
	);
}
