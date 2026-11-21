/** Legacy cards have only their original serverId. Never join to today's inventory for history. */
export function withHostedServerSnapshot<T extends { params: string; serverId: string | null }>(action: T) {
  let server: { id: string; name: string; host: string } | null = null;
  try {
    const snapshot = JSON.parse(action.params).serverSnapshot;
    if (snapshot && snapshot.id === action.serverId && typeof snapshot.name === "string" && typeof snapshot.host === "string") {
      server = { id: snapshot.id, name: snapshot.name, host: snapshot.host };
    }
  } catch { /* Legacy or malformed params. */ }
  return { ...action, server };
}
