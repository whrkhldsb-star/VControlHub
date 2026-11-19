export function ExecutionEvidence({
  target,
  translate,
}: {
  target: { executionChannel?: string | null; fallbackReason?: string | null; outcomeUnknown?: boolean };
  translate: (key: string) => string;
}) {
  const reason =
    target.fallbackReason === "AGENT_OFFLINE"
      ? translate("serverOverviewDetails.agentUnavailable")
      : target.fallbackReason === "AGENT_UNCLAIMED"
        ? translate("serverOverviewDetails.agentUnclaimed")
        : null;
  return (
    <div className="text-xs text-[var(--text-muted)]">
      {target.executionChannel
        ? `${translate("serverOverviewDetails.channel")} · ${target.executionChannel}`
        : translate("serverOverviewDetails.channelUnrecorded")}
      {reason && ` · ${reason}`}
      {target.outcomeUnknown && (
        <p className="text-[var(--warning)]">{translate("serverOverviewDetails.unknownResult")}</p>
      )}
    </div>
  );
}
