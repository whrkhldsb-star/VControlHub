import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { UserManagementClient } from "./users-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
	const session = await requireSession("/users");
	const canRead = sessionHasPermission(session, "user:read");
	const canManage = sessionHasPermission(session, "user:manage");

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text={t("users.noPermission")} variant="boxed" /></PageShell>;
	}

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow="Users"
				title={t("users.title")}
				description={canManage ? t("users.desc.manage") : t("users.desc.readonly")}
			/>
			<UserManagementClient canManage={canManage} />
		</PageShell>
	);
}
