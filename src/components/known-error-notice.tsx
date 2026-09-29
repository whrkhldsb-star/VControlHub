/**
 * Localized raw-error notice shared by the files browser and the share
 * picker's storage surfaces.
 *
 * Renders a localized summary (matched from known error codes via
 * `describeKnownError`) with the raw system message kept as a monospace
 * detail line for diagnosis. Full color on the detail line — a reduced-alpha
 * variant fails axe color-contrast in the light theme.
 */
"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { Notice } from "@/components/ui-primitives";
import { describeKnownError } from "@/lib/ui/known-error-copy";

export function KnownErrorNotice({
  tone,
  raw,
  className,
}: {
  tone: "warning" | "danger" | "rose" | "amber";
  raw: string;
  className?: string;
}) {
  const { t } = useI18n();
  const { summary, detail } = describeKnownError(raw, t);
  // "rose"/"amber" were the picker's tone names; map onto Notice's vocabulary.
  const noticeTone = tone === "rose" ? "danger" : tone === "amber" ? "warning" : tone;
  return (
    <Notice tone={noticeTone} className={className}>
      {summary}
      <code className="mt-1 block break-all font-mono text-xs">{detail}</code>
    </Notice>
  );
}
