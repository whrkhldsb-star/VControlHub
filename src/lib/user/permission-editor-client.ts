import { apiRequest, type ApiRequestInit } from "@/lib/http/api-client";

type Grant = Record<string, unknown>;
type Resource = "server" | "storage";
type PermissionDraft = {
  userId: string;
  account?: unknown;
  storageAccess?: Grant[];
  serverAccess?: Grant[];
  storageAccessScopeIds?: string[];
  serverAccessScopeIds?: string[];
  version?: string;
};
type EditorView = {
  version: string;
  user: { id: string; storageAccess: Grant[]; serverAccess: Grant[] };
};

const fields = {
  server: ["serverId", "canRead", "canConnect", "canManage", "canFileRead", "canFileWrite", "canFileDelete"],
  storage: ["storageNodeId", "pathPrefix", "canRead", "canWrite", "canDelete", "quotaBytes", "maxFileBytes"],
} as const;

function grouped(rows: Grant[], resource: Resource) {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const id = String(row[fields[resource][0]]);
    const group = groups.get(id) ?? [];
    group.push(JSON.stringify(fields[resource].map(key => row[key])));
    groups.set(id, group);
  }
  return groups;
}

function changedResources(resource: Resource, before: Grant[], after: Grant[], scope: string[]) {
  const saved = grouped(before, resource);
  const draft = grouped(after, resource);
  const ids = new Set(scope);
  for (const id of ids) {
    if (JSON.stringify(saved.get(id)?.sort() ?? []) === JSON.stringify(draft.get(id)?.sort() ?? [])) ids.delete(id);
  }
  const rows = after.filter(row => ids.has(String(row[fields[resource][0]])))
    .map(row => Object.fromEntries(fields[resource].map(key => [key, row[key]])));
  return { ids: [...ids], rows };
}

export function permissionChanges(view: EditorView, body: PermissionDraft): PermissionDraft {
  const patch: PermissionDraft = { userId: body.userId, version: view.version, account: body.account };
  for (const resource of ["storage", "server"] as const) {
    const grants = `${resource}Access` as const;
    const scope = `${resource}AccessScopeIds` as const;
    if (!body[grants] || !body[scope]) continue;
    const changed = changedResources(resource, view.user[grants], body[grants], body[scope]);
    if (changed.ids.length) {
      patch[grants] = changed.rows;
      patch[scope] = changed.ids;
    }
  }
  return patch;
}

// The existing dialog uses csrfFetch for its read and save. Keep exactly one
// edit baseline per browser document. Another tab has its own read version.
// A read superseded by navigation cannot replace a newer dialog's baseline.
let activeRead: symbol | undefined;
let view: EditorView | undefined;
export async function readPermissionEditor(url: string, init?: ApiRequestInit) {
  const reading = Symbol();
  activeRead = reading;
  view = undefined;
  const loaded = await apiRequest<EditorView>(url, init);
  if (activeRead === reading) view = loaded;
  return loaded;
}

export async function savePermissionEditor(url: string, init: ApiRequestInit) {
  const draft: PermissionDraft = JSON.parse(String(init.body));
  const initial = view;
  if ("version" in draft || !initial || initial.user.id !== draft.userId) return apiRequest(url, init);
  const patch = permissionChanges(initial, draft);
  const result = await apiRequest<{ success: boolean; version: string }>(url, { ...init, body: JSON.stringify(patch) });
  if (view === initial) {
    view = { version: result.version, user: { id: draft.userId,
      storageAccess: draft.storageAccess ?? initial.user.storageAccess,
      serverAccess: draft.serverAccess ?? initial.user.serverAccess } };
  }
  return result;
}
