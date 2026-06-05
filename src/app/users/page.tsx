import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { UserManagementClient } from "./users-client";
import { PageShell, EmptyState } from "@/components/page-shell";

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
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white light:text-slate-900">用户管理</h1>
				<p className="mt-1.5 text-sm text-slate-500">{canManage ? "创建用户、分配角色与权限管理" : "查看用户、角色与权限（只读）"}</p>
			</header>
			<UserManagementClient canManage={canManage} />
		</PageShell>
	);
}
