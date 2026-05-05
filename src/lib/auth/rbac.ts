export const PERMISSIONS = [
  "audit:read",
  "command:approve",
  "command:create",
  "command:execute",
  "command:read",
  "role:manage",
  "server:read",
  "server:write",
  "storage:delete",
  "storage:manage-node",
  "storage:read",
  "storage:write",
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
    "audit:read",
    "command:create",
    "command:execute",
    "command:read",
    "server:read",
    "server:write",
    "storage:read",
    "storage:write",
    "user:read",
  ],
  viewer: [
    "audit:read",
    "command:read",
    "server:read",
    "storage:read",
    "user:read",
  ],
  storage_manager: [
    "audit:read",
    "command:read",
    "server:read",
    "storage:delete",
    "storage:manage-node",
    "storage:read",
    "storage:write",
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
