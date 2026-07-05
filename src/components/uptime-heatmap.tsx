"use client";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
interface UptimeDay {
  date: Date;
  uptimePercent: number;
  checkCount: number;
}
interface UptimeHeatmapProps {
  data: UptimeDay[];
  serverName: string;
}
export function UptimeHeatmap({ data, serverName }: UptimeHeatmapProps) {
  const { t } = useI18n();
  const normalizedData = useMemo(() => {
    const map = new Map<string, UptimeDay>();
    data.forEach((d) => {
      const key = d.date.toISOString().split("T")[0];
      if (key) map.set(key, d);
    });
    const result: UptimeDay[] = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split("T")[0];
      if (dateKey && map.has(dateKey)) {
        const existing = map.get(dateKey);
        if (existing) result.push(existing);
      } else {
        result.push({ date, uptimePercent: 0, checkCount: 0 });
      }
    }
    return result;
  }, [data]);
  const sla = useMemo(() => {
    if (normalizedData.length === 0) return 0;
    const sum = normalizedData.reduce((acc, d) => acc + d.uptimePercent, 0);
    return Math.round((sum / normalizedData.length) * 100) / 100;
  }, [normalizedData]);
  const getColorClass = (uptime: number) => {
    if (uptime === 0 || uptime === null || uptime === undefined)
      return "bg-[var(--surface-hover)]";
    if (uptime >= 99) return "bg-[var(--success)]";
    if (uptime >= 95) return "bg-[var(--success)]";
    if (uptime >= 90) return "bg-[var(--warning)]";
    if (uptime >= 75) return "bg-[var(--warning)]";
    return "bg-[var(--danger)]";
  };
  const weeks = useMemo(() => {
    const result: UptimeDay[][] = [];
    for (let i = 0; i < normalizedData.length; i += 7) {
      result.push(normalizedData.slice(i, i + 7));
    }
    return result;
  }, [normalizedData]);
  return (
    <div className="space-y-4">
      {" "}
      <div className="flex items-center justify-between">
        {" "}
        <h3 className="text-sm font-medium">{serverName || "Server"}</h3>{" "}
        <div className="flex items-center gap-4">
          {" "}
          <div className="text-xs text-[var(--text-muted)]">
            {t("uptimeHeatmap.sla90")}:{" "}
            <span className="font-mono text-sm">{sla}%</span>{" "}
          </div>{" "}
          <div className="flex gap-1">
            {" "}
            {[99, 95, 90, 75, 0].map((threshold) => (
              <div
                key={threshold}
                className="h-3 w-3 rounded"
                title={`≥ ${threshold}%`}
                style={{
                  backgroundColor: getColorClass(threshold).replace("bg-", ""),
                }}
              />
            ))}{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
      <div className="space-y-1">
        {" "}
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="flex gap-1">
            {" "}
            {week.map((day, dayIndex) => {
              const isFirstDayOfWeek = dayIndex === 0;
              const dayDate = day.date.toISOString().split("T")[0] || "";
              return (
                <div
                  key={`${weekIndex}-${dayIndex}`}
                  className={`h-4 w-4 rounded ${getColorClass(day.uptimePercent)} transition hover:scale-125 hover:z-10`}
                  title={`${dayDate}: ${day.uptimePercent}% (${day.checkCount} checks)`}
                />
              );
            })}{" "}
          </div>
        ))}{" "}
      </div>{" "}
    </div>
  );
}
