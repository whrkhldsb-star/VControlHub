export const PERMISSIONS = [
  "audit:read",
  "backup:create",
  "backup:read",
  "backup:restore",
  "command:approve",
  "command:create",
  "command:execute",
  "command:read",
  "deploy:manage",
  "deploy:read",
  "deploy:run",
  "health:read",
  "notification:manage",
  "role:manage",
  "server:read",
  "server:write",
  "share:create",
  "share:manage",
  "share:read",
  "storage:delete",
  "storage:manage-node",
  "storage:read",
  "storage:write",
  "task:read",
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
    "backup:create",
    "backup:read",
    "command:create",
    "command:execute",
    "command:read",
    "deploy:read",
    "deploy:run",
    "health:read",
    "notification:manage",
    "server:read",
    "server:write",
    "share:create",
    "share:manage",
    "share:read",
    "storage:read",
    "storage:write",
    "task:read",
    "user:read",
  ],
  viewer: [
    "audit:read",
    "backup:read",
    "command:read",
    "deploy:read",
    "health:read",
    "server:read",
    "share:read",
    "storage:read",
    "task:read",
    "user:read",
  ],
  storage_manager: [
    "audit:read",
    "backup:read",
    "command:read",
    "health:read",
    "server:read",
    "share:create",
    "share:manage",
    "share:read",
    "storage:delete",
    "storage:manage-node",
    "storage:read",
    "storage:write",
    "task:read",
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
