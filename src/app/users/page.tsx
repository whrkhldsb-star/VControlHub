import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { UserManagementClient } from "./users-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const revalidate = 60;

export default async function UsersPage() {
	const session = await requireSession("/users");
	const canRead = sessionHasPermission(session, "user:read");
	const canManage = sessionHasPermission(session, "user:manage");
	const locale = await getServerLocale();

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text={t("users.noPermission", locale)} variant="boxed" /></PageShell>;
	}

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("usersPage.eyebrow", locale)}
				title={t("users.title", locale)}
				description={canManage ? t("users.desc.manage", locale) : t("users.desc.readonly", locale)}
			/>
			<UserManagementClient canManage={canManage} currentUserId={session.userId} />
		</PageShell>
	);
}
