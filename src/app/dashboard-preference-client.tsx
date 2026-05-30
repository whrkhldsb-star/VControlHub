"use client";

import { useEffect, useMemo, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
  DASHBOARD_WIDGET_IDS,
  normalizeUserPreferences,
  type DashboardWidgetId,
  type UserPreferences,
} from "@/lib/preferences/user-preferences";

export type DashboardPreferences = Pick<UserPreferences, "dashboardWidgets">;

const defaultDashboardPreferences: DashboardPreferences = {
  dashboardWidgets: [...DASHBOARD_WIDGET_IDS],
};

export function DashboardPreferenceClient({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences);

  useEffect(() => {
    let active = true;

    const loadPreferences = (value: unknown) => {
      const nextPreferences = normalizeUserPreferences(value);
      if (active) {
        setPreferences({ dashboardWidgets: nextPreferences.dashboardWidgets });
      }
    };

    try {
      const raw = window.localStorage.getItem("vps-preferences");
      if (raw) loadPreferences(JSON.parse(raw));
    } catch {
      // Ignore broken local preference cache and fall back to server/defaults.
    }

    csrfFetch("/api/preferences")
      .then((data) => {
        const nextPreferences = normalizeUserPreferences(data);
        window.localStorage.setItem("vps-preferences", JSON.stringify(nextPreferences));
        loadPreferences(nextPreferences);
      })
      .catch(() => {
        // The dashboard itself is still usable; preference fetch failures should not hide widgets.
      });

    const onStorage = () => {
      try {
        const raw = window.localStorage.getItem("vps-preferences");
        loadPreferences(raw ? JSON.parse(raw) : null);
      } catch {
        loadPreferences(null);
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("vps-preferences-updated", onStorage);

    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("vps-preferences-updated", onStorage);
    };
  }, []);

  const hiddenWidgetIds = useMemo(() => {
    const visible = new Set(preferences.dashboardWidgets);
    return DASHBOARD_WIDGET_IDS.filter((id): id is DashboardWidgetId => !visible.has(id));
  }, [preferences.dashboardWidgets]);

  return (
    <>
      <style>{hiddenWidgetIds.map((id) => `[data-dashboard-widget="${id}"]{display:none}`).join("\n")}</style>
      {children}
    </>
  );
}
