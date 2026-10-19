/**
 * The Agent build this hub installs. Installed Agents report theirs on every
 * poll and keep running it until they are installed again: Linux through
 * the reinstall action over SSH, Windows by running a new install command.
 */
export const AGENT_VERSION = "1.4.1";

/** An Agent that reported a version other than the current build. */
export function isAgentOutdated(version: string | null | undefined): boolean {
  return Boolean(version) && version !== AGENT_VERSION;
}
