const RECENT_OFFLINE_WINDOW_MS = 5 * 60 * 1000;
const AGENT_FRESH_WINDOW_MS = 90 * 1000;

export type ServerAvailabilityInput = {
  operatingSystem?: string | null;
  onboardingStatus?: string | null;
  managementMode?: string | null;
  agentLastSeenAt?: Date | string | null;
  hasSshCredential?: boolean;
  latestMetric?: { isOnline: boolean; createdAt: Date | string } | null;
};

export function getServerTargetAvailability(input: ServerAvailabilityInput, now = Date.now()) {
  if (input.onboardingStatus && input.onboardingStatus !== "READY") {
    return { available: false, reason: "setup-incomplete" as const };
  }
  if (input.operatingSystem === "WINDOWS" && input.managementMode !== "AGENT") {
    return { available: false, reason: "setup-incomplete" as const };
  }
  if (input.managementMode === "AGENT") {
    const lastSeenAt = input.agentLastSeenAt
      ? new Date(input.agentLastSeenAt).getTime()
      : Number.NaN;
    if (Number.isFinite(lastSeenAt) && now - lastSeenAt <= AGENT_FRESH_WINDOW_MS) {
      return { available: true, reason: null };
    }
    if (input.operatingSystem === "WINDOWS" || input.hasSshCredential === false) {
      return { available: false, reason: "recently-offline" as const };
    }
  }
  const metric = input.latestMetric;
  const checkedAt = metric ? new Date(metric.createdAt).getTime() : Number.NaN;
  if (metric && !metric.isOnline && Number.isFinite(checkedAt) && now - checkedAt <= RECENT_OFFLINE_WINDOW_MS) {
    return { available: false, reason: "recently-offline" as const };
  }
  return { available: true, reason: null };
}

export const OPERATION_TARGET_SELECT = {
  operatingSystem: true, onboardingStatus: true, managementMode: true, agentLastSeenAt: true,
  connectionType: true, sshKeyId: true, password: true,
  metricSnapshots: { select: { isOnline: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

export function operationTargetAvailability(server: {
  operatingSystem: string; onboardingStatus: string; managementMode: string; agentLastSeenAt: Date | null;
  connectionType: string; sshKeyId: string | null; password: string | null;
  metricSnapshots: { isOnline: boolean; createdAt: Date }[];
}) {
  return getServerTargetAvailability({
    operatingSystem: server.operatingSystem, onboardingStatus: server.onboardingStatus,
    managementMode: server.managementMode, agentLastSeenAt: server.agentLastSeenAt,
    hasSshCredential: Boolean(server.connectionType === "SSH_KEY" ? server.sshKeyId : server.password),
    latestMetric: server.metricSnapshots?.[0] ?? null,
  });
}
