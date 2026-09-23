import type { Permission, RoleKey } from "./rbac";
import { sessionHasPermission } from "./authorization";

export type SshAccessSession = {
  roles: RoleKey[];
  /** Effective permissions (roles ∪ per-user direct grants) when available. */
  permissions?: Permission[];
};

/**
 * `server:ssh` gates the WebSocket terminal. Resolved through
 * `sessionHasPermission` so per-user direct grants behave exactly like the
 * HTTP surface (which mints sessions with effective permissions) — a user
 * holding a direct `server:ssh` grant is authorized over HTTP and must not
 * be denied a terminal session.
 */
export function canUseSshTerminal(session: SshAccessSession) {
  return sessionHasPermission(session, "server:ssh");
}
