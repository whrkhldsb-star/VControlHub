import { browserT } from "@/lib/i18n/browser-translations";
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

const PRESET_GROUP_KEYS = ["viewer", "operator", "storage_manager"] as const;

/**
 * Display name of a permission group. Built-in groups were created with
 * Chinese preset names; while a group keeps a preset name (in either
 * language) it is shown in the viewer's language, renamed groups as typed.
 */
export function permissionGroupName(group: { name: string; isBuiltin: boolean }, t: (key: string) => string): string {
	if (!group.isBuiltin) return group.name;
	const preset = PRESET_GROUP_KEYS.find((key) => {
		const nameKey = `settingsTeam.preset.${key}.name`;
		return group.name === browserT(nameKey, "zh") || group.name === browserT(nameKey, "en");
	});
	return preset ? t(`settingsTeam.preset.${preset}.name`) : group.name;
}
