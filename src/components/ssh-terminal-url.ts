type BuildSshWebSocketUrlInput = {
  pageProtocol: string;
  host: string;
  serverId: string;
  /** @deprecated session JWT must not be placed in the query string; cookies carry auth. */
  sessionToken?: string;
  handshakeToken: string;
};

export function buildSshWebSocketUrl(input: BuildSshWebSocketUrlInput) {
  const protocol = input.pageProtocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    serverId: input.serverId,
    handshake: input.handshakeToken,
  });

  return `${protocol}//${input.host}/ssh?${params.toString()}`;
}
