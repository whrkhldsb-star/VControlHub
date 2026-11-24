import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import { canReadCommandBody } from "@/lib/command/visibility";

export type TemplateViewer = { userId: string; roles: RoleKey[]; permissions?: Permission[] };

/**
 * Built-in templates are public defaults. Any other template's command and rollback command belong to its author:
 * only the author or a command approver reads them (the same rule as command requests and deployment snapshots).
 */
export function canReadTemplateBody(
	template: { isBuiltin?: boolean | null; createdById?: string | null },
	viewer: TemplateViewer,
): boolean {
	if (template.isBuiltin) return true;
	return canReadCommandBody(viewer.userId, template.createdById ?? null, sessionHasPermission(viewer, "command:approve"));
}

/** Blank the command bodies of a template the viewer may not read. */
export function redactTemplateBody<T extends { isBuiltin?: boolean | null; createdById?: string | null; command: string; rollbackCommand: string | null }>(
	template: T,
	viewer: TemplateViewer,
): T {
	return canReadTemplateBody(template, viewer) ? template : { ...template, command: "", rollbackCommand: null };
}
