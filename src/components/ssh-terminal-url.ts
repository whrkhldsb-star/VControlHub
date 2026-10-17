type BuildSshWebSocketUrlInput = {
  pageProtocol: string;
  host: string;
  serverId: string;
  handshakeToken: string;
  /** Ask the proxy to keep the shell for a reconnect after the socket drops. */
  keepAlive?: boolean;
  /** A shell the proxy kept for us; the proxy decides whether it is still there. */
  resumeId?: string | null;
  /** How much of that shell's output this terminal already shows (bytes). */
  resumeOffset?: number | null;
};

export function buildSshWebSocketUrl(input: BuildSshWebSocketUrlInput) {
  const protocol = input.pageProtocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    serverId: input.serverId,
    handshake: input.handshakeToken,
  });
  if (input.keepAlive) params.set("keepAlive", "1");
  if (input.keepAlive && input.resumeId) {
    params.set("resume", input.resumeId);
    if (input.resumeOffset !== null && input.resumeOffset !== undefined && Number.isSafeInteger(input.resumeOffset) && input.resumeOffset >= 0) {
      params.set("offset", String(input.resumeOffset));
    }
  }

  return `${protocol}//${input.host}/ssh?${params.toString()}`;
}
