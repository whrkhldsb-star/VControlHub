import { DEFAULT_REFRESH_INTERVAL_SECONDS, normalizeRefreshIntervalSeconds } from "./refresh-interval";
import { DEFAULT_AUTO_PROBE_INTERVAL_SEC, normalizeAutoProbeIntervalSec } from "./auto-probe";
import { getPermissionsFromRoles, type Permission, type RoleKey } from "@/lib/auth/rbac";

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DefaultPageOption = (typeof DEFAULT_PAGE_OPTIONS)[number];

export type UserPreferences = {
  defaultPage: DefaultPageOption;
  dashboardWidgets: DashboardWidgetId[];
  notificationsEnabled: boolean;
  notificationSound: boolean;
  autoRefreshInterval: number;
  autoProbeEnabled: boolean;
  autoProbeIntervalSec: number;
};

export const DASHBOARD_WIDGET_IDS = ["server-status", "quick-links", "analytics", "audit-log"] as const;
export const DEFAULT_PAGE_OPTIONS = ["/", "/servers", "/files", "/docker", "/monitoring", "/downloads", "/ai"] as const;

/**
 * A default page is a post-login destination, not an authorization bypass.
 * Keep this mapping alongside the selectable routes so API, login and UI
 * apply the same policy when roles or saved preferences change.
 */
export const DEFAULT_PAGE_REQUIRED_PERMISSION: Record<DefaultPageOption, Permission | null> = {
  "/": null,
  "/servers": "server:read",
  "/files": "storage:read",
  "/docker": "docker:manage",
  "/monitoring": "health:read",
  "/downloads": "storage:read",
  "/ai": "ai:chat",
};

/**
 * Widget display labels (zh) — used by the customize toolbar.
 * Keep in sync with `DASHBOARD_WIDGET_IDS`. These are intentionally
 * a Record (not a type) so a missing label surfaces a TS error if a
 * new widget is added without one.
 */
export const DASHBOARD_WIDGET_LABELS: Record<DashboardWidgetId, string> = {
	"server-status": "dashboard.widget.serverStatus",
	"quick-links": "dashboard.widget.quickLinks",
	analytics: "dashboard.widget.analytics",
	"audit-log": "dashboard.widget.auditLog",
};

export const defaultUserPreferences: UserPreferences = {
  defaultPage: "/",
  dashboardWidgets: [...DASHBOARD_WIDGET_IDS],
  notificationsEnabled: true,
  notificationSound: true,
  autoRefreshInterval: DEFAULT_REFRESH_INTERVAL_SECONDS,
  autoProbeEnabled: true,
  autoProbeIntervalSec: DEFAULT_AUTO_PROBE_INTERVAL_SEC,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeDefaultPage(value: unknown): DefaultPageOption {
  if (typeof value !== "string") return defaultUserPreferences.defaultPage;
  const trimmed = value.trim();
  return (DEFAULT_PAGE_OPTIONS as readonly string[]).includes(trimmed) ? (trimmed as DefaultPageOption) : defaultUserPreferences.defaultPage;
}

export function normalizeDashboardWidgets(value: unknown): DashboardWidgetId[] {
  if (!Array.isArray(value)) return defaultUserPreferences.dashboardWidgets;
  const allowed = new Set<string>(DASHBOARD_WIDGET_IDS);
  const normalized = value.filter((item): item is DashboardWidgetId => typeof item === "string" && allowed.has(item));
  return Array.from(new Set(normalized));
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  return {
    defaultPage: normalizeDefaultPage(source.defaultPage),
    dashboardWidgets: normalizeDashboardWidgets(source.dashboardWidgets),
    notificationsEnabled: typeof source.notificationsEnabled === "boolean" ? source.notificationsEnabled : defaultUserPreferences.notificationsEnabled,
    notificationSound: typeof source.notificationSound === "boolean" ? source.notificationSound : defaultUserPreferences.notificationSound,
    autoRefreshInterval: normalizeRefreshIntervalSeconds(source.autoRefreshInterval, defaultUserPreferences.autoRefreshInterval),
    autoProbeEnabled: typeof source.autoProbeEnabled === "boolean" ? source.autoProbeEnabled : defaultUserPreferences.autoProbeEnabled,
    autoProbeIntervalSec: normalizeAutoProbeIntervalSec(source.autoProbeIntervalSec, defaultUserPreferences.autoProbeIntervalSec),
  };
}

/** Return only post-login destinations available to the current permission set. */
export function getAvailableDefaultPageOptions(
  canUsePermission: (permission: Permission) => boolean,
): DefaultPageOption[] {
  return DEFAULT_PAGE_OPTIONS.filter((page) => {
    const permission = DEFAULT_PAGE_REQUIRED_PERMISSION[page];
    return permission === null || canUsePermission(permission);
  });
}

/**
 * Normalize user preferences and fall back to the dashboard if the stored
 * landing page is no longer available. This happens after role changes and
 * also protects direct API writes that skip the client picker.
 */
export function normalizeUserPreferencesForAllowedDefaultPages(
  value: unknown,
  allowedPages: readonly DefaultPageOption[],
): UserPreferences {
  const normalized = normalizeUserPreferences(value);
  return allowedPages.includes(normalized.defaultPage)
    ? normalized
    : { ...normalized, defaultPage: defaultUserPreferences.defaultPage };
}

/** Server-side convenience wrapper for role-derived permissions. */
export function normalizeUserPreferencesForRoles(
  value: unknown,
  roles: readonly RoleKey[] | undefined,
): UserPreferences {
  const permissions = new Set(getPermissionsFromRoles([...(roles ?? [])]));
  return normalizeUserPreferencesForAllowedDefaultPages(
    value,
    getAvailableDefaultPageOptions((permission) => permissions.has(permission)),
  );
}
