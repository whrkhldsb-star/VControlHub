export const PERMISSIONS = [
	"announcement:manage",
	"api-token:manage",
	"audit:read",
	"ai:chat",
	"ai:manage",
	"ai:action:approve",
	"backup:create",
	"backup:read",
	"backup:restore",
	"command:approve",
	"command:create",
	"command:execute",
	"command:read",
	// TR-031 E01: 成本追踪 (cost:read 看 /cost-summary + 月报, cost:manage 增删改)
	"cost:read",
	"cost:manage",
	"deploy:manage",
	"deploy:read",
	"deploy:run",
	"deploy:export",
	"docker:manage",
	"health:read",
	"image:read",
	"image:write",
	"media:manage",
	"notification:manage",
	"playbook:manage",
	"playbook:read",
	"playbook:run",
	"role:manage",
	"server:read",
	"server:ssh",
	"server:write",
	"share:create",
	"share:manage",
	"share:read",
	"snippet:manage",
	"storage:delete",
	"storage:manage-node",
	"storage:read",
	"storage:write",
	"task:read",
	"ticket:create",
	"ticket:manage",
	"ticket:read",
	"user:manage",
	"user:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type RoleKey = "admin" | "operator" | "viewer" | "storage_manager";
export type ApprovalActorType = "assistant" | "user";
export type ApprovalActionType =
	| "command.execute"
	| "storage.delete"
	| "server.write"
	| "storage.write";

export const ALL_PERMISSIONS = [...PERMISSIONS] satisfies Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
	admin: ALL_PERMISSIONS,
	operator: [
		"announcement:manage",
		"api-token:manage",
		"audit:read",
		"ai:chat",
		"ai:manage",
		"backup:create",
		"backup:read",
		"command:create",
		"command:execute",
		"command:read",
		"cost:read",
		"cost:manage",
		"deploy:read",
		"deploy:run",
		"deploy:export",
		"docker:manage",
		"health:read",
		"media:manage",
		"notification:manage",
		"playbook:read",
		"playbook:run",
		"server:read",
		"server:ssh",
		"server:write",
		"share:create",
		"share:manage",
		"share:read",
		"snippet:manage",
		"storage:read",
		"storage:write",
		"task:read",
		"ticket:create",
		"ticket:manage",
		"ticket:read",
		"user:read",
	],
	viewer: [
		"ai:chat",
		"audit:read",
		"backup:read",
		"command:read",
		"cost:read",
		"deploy:read",
		"health:read",
		"server:read",
		"share:read",
		"storage:read",
		"task:read",
		"ticket:create",
		"ticket:read",
		"user:read",
	],
	storage_manager: [
		"ai:chat",
		"audit:read",
		"backup:read",
		"command:read",
		"health:read",
		"media:manage",
		"server:read",
		"share:create",
		"share:manage",
		"share:read",
		"snippet:manage",
		"storage:delete",
		"storage:manage-node",
		"storage:read",
		"storage:write",
		"task:read",
		"ticket:create",
		"ticket:manage",
		"ticket:read",
		"user:read",
	],
};

const ASSISTANT_APPROVAL_ACTIONS: ApprovalActionType[] = [
	"command.execute",
	"storage.delete",
	"server.write",
	"storage.write",
];

export function isProtectedByApproval(input: {
	actorType: ApprovalActorType;
	actionType: ApprovalActionType;
}): boolean {
	if (input.actorType === "user") {
		return false;
	}

	return ASSISTANT_APPROVAL_ACTIONS.includes(input.actionType);
}
