import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { EmptyState, PageShell } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { CustomersClient } from "./customers-client";

export const dynamic = "force-dynamic";

/** Platform administrators manage customers, their accounts and identity templates. */
export default async function CustomersPage() {
	const session = await requireSession("/customers");
	const locale = await getServerLocale();
	if (!sessionHasPermission(session, "team:manage")) {
		return <PageShell><EmptyState text={t("customersPage.noPermission", locale)} variant="boxed" /></PageShell>;
	}
	return (
		<PageShell>
			<CustomersClient />
		</PageShell>
	);
}
