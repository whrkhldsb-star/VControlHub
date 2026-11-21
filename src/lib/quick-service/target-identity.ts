export const HUB_HOST_INSTANCE_KEY = "hub-host";

export function isQuickServiceTargetConsistent(instanceKey: string, serverId: string | null): boolean {
  return instanceKey === HUB_HOST_INSTANCE_KEY ? serverId === null : Boolean(instanceKey) && serverId === instanceKey;
}
