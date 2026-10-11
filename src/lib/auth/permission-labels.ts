import type { Permission } from "./rbac";

/** Translation key of a permission's human name: "server:sftp:unrestricted" → "permission.server.sftp.unrestricted". */
export function permissionLabelKey(permission: Permission | string): string {
	return `permission.${permission.replace(/:/g, ".")}`;
}

/** Permissions grouped by the domain before the first ":", in first-seen order. */
export function groupPermissionsByDomain<T extends string>(permissions: readonly T[]): Array<{ domain: string; labelKey: string; permissions: T[] }> {
	const groups = new Map<string, T[]>();
	for (const permission of permissions) {
		const domain = permission.split(":")[0]!;
		groups.set(domain, [...(groups.get(domain) ?? []), permission]);
	}
	return [...groups].map(([domain, items]) => ({ domain, labelKey: `permissionDomain.${domain}`, permissions: items }));
}
