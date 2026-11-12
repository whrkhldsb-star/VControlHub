import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { loadPasswordPolicy } from "@/lib/auth/password-policy";
import { UserManagementClient } from "./users-client";
import { PageShell } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
	const session = await requirePagePermission("user:read", { redirectTo: "/users" });
	const canManage = sessionHasPermission(session, "user:manage");
	const locale = await getServerLocale();
	// What a password has to have, for the fields that set one: they said "at least 6 characters" whatever
	// the policy was.
	const passwordRules = canManage ? await loadPasswordPolicy() : undefined;

	return (
		<PageShell>
			<UserManagementClient
				header={{
					eyebrow: t("usersPage.eyebrow", locale),
					title: t("users.title", locale),
					description: canManage ? t("users.desc.manage", locale) : t("users.desc.readonly", locale),
				}}
				canManage={canManage}
				currentUserId={session.userId}
				passwordRules={passwordRules}
			/>
		</PageShell>
	);
}
