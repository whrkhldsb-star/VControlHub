import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { UserManagementClient } from "./users-client";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
	const session = await requireSession("/users");
	const canRead = sessionHasPermission(session, "user:read");
	const canManage = sessionHasPermission(session, "user:manage");

	if (!canRead) {
		return <PageShell maxW="max-w-7xl"><EmptyState text="你没有查看用户的权限。" variant="boxed" /></PageShell>;
	}

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow="Users"
				title="用户管理"
				description={canManage ? "创建用户、分配角色与权限管理" : "查看用户、角色与权限（只读）"}
			/>
			<UserManagementClient canManage={canManage} />
		</PageShell>
	);
}
