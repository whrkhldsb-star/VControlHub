import { requirePagePermission } from "@/lib/auth/page-guard";
import { PageShell } from "@/components/page-shell";
import { CustomersClient } from "./customers-client";

export const dynamic = "force-dynamic";

/** Platform administrators manage customers, their accounts and identity templates. */
export default async function CustomersPage() {
	await requirePagePermission("team:manage", { redirectTo: "/customers" });
	return (
		<PageShell>
			<CustomersClient />
		</PageShell>
	);
}
