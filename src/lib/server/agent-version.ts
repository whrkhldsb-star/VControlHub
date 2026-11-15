/**
 * The Agent builds this hub installs, one per platform. Each moves only when its own script changes, so a
 * change to the Linux Agent does not tell every Windows node to run its install command again for the same
 * script. Installed Agents report their build on every poll. A Linux Agent from 1.5.0 on installs the Linux
 * build itself when it is idle (agentSelfUpdateFor); older ones keep theirs until they are installed again
 * over SSH, and Windows Agents until a new install command is run.
 *
 * Linux 1.5.2: a stop that arrives while a command is being started, or while its result is put together, no
 * longer leaves the command running and unreported (the hub waited out its lease).
 */
export const AGENT_VERSION = "1.5.2";

/** The Windows (PowerShell) Agent build: unchanged since 1.5.1. */
export const WINDOWS_AGENT_VERSION = "1.5.1";

export type AgentPlatform = "linux" | "windows";

/** The build this hub installs on the platform. */
export function currentAgentVersion(platform: AgentPlatform = "linux"): string {
  return platform === "windows" ? WINDOWS_AGENT_VERSION : AGENT_VERSION;
}

/** An Agent that reported a build other than the platform's current one. */
export function isAgentOutdated(version: string | null | undefined, platform: AgentPlatform = "linux"): boolean {
  return Boolean(version) && version !== currentAgentVersion(platform);
}
