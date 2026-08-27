type BuildSshWebSocketUrlInput = {
  pageProtocol: string;
  host: string;
  serverId: string;
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
