/**
 * The Agent build this hub installs. Installed Agents report theirs on every
 * poll. A Linux Agent from 1.5.0 on installs this build itself when it is
 * idle (agentSelfUpdateFor); older ones keep theirs until they are installed
 * again over SSH, and Windows Agents until a new install command is run.
 */
export const AGENT_VERSION = "1.5.1";

/** An Agent that reported a version other than the current build. */
export function isAgentOutdated(version: string | null | undefined): boolean {
  return Boolean(version) && version !== AGENT_VERSION;
}
