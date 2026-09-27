/** A server override only narrows account permissions; missing rows inherit them. */
export const SERVER_ACCESS_FIELDS = {
  read: "canRead",
  connect: "canConnect",
  manage: "canManage",
  fileRead: "canFileRead",
  fileWrite: "canFileWrite",
  fileDelete: "canFileDelete",
} as const;

export type ServerAccessCapability = keyof typeof SERVER_ACCESS_FIELDS;

export function serverAccessWhere(userId: string, capability: ServerAccessCapability) {
  const field = SERVER_ACCESS_FIELDS[capability];
  return {
    OR: [
      { userAccess: { none: { userId } } },
      { userAccess: { some: { userId, [field]: true } } },
    ],
  };
}
