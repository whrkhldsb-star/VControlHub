import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

export type StatusTone =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]",
  accent: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
  info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
};

/**
 * Semantic tone classes for elements that cannot be a StatusBadge — an
 * interactive chip, say. Prefer the component; reach for this only when the
 * element must stay a button/link. Hand-rolled `data-tone="warning"` does NOT
 * work: globals.css maps `data-tone` to the seven hue names only.
 */
export function statusToneClass(tone: StatusTone): string {
  return STATUS_TONE_CLASS[tone];
}

const STATUS_DATA_TONE: Record<StatusTone, string> = {
  neutral: "neutral",
  accent: "violet",
  info: "sky",
  success: "emerald",
  warning: "amber",
  danger: "rose",
};

type Props = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  children: ReactNode;
  tone?: StatusTone;
  size?: "sm" | "md";
};

/** Shared semantic status pill for list, card and table states. */
export function StatusBadge({
  children,
  tone = "neutral",
  size = "sm",
  className,
  ...props
}: Props) {
  return (
    <span
      data-status-badge
      data-tone={STATUS_DATA_TONE[tone]}
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        STATUS_TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
