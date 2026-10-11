type BuildSshWebSocketUrlInput = {
  pageProtocol: string;
  host: string;
  serverId: string;
  handshakeToken: string;
  /** Ask the proxy to keep the shell for a reconnect after the socket drops. */
  keepAlive?: boolean;
  /** A shell the proxy kept for us; the proxy decides whether it is still there. */
  resumeId?: string | null;
};

export function buildSshWebSocketUrl(input: BuildSshWebSocketUrlInput) {
  const protocol = input.pageProtocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    serverId: input.serverId,
    handshake: input.handshakeToken,
  });
  if (input.keepAlive) params.set("keepAlive", "1");
  if (input.keepAlive && input.resumeId) params.set("resume", input.resumeId);

  return `${protocol}//${input.host}/ssh?${params.toString()}`;
}
