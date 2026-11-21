type BoundEndpoint = { teamId: string | null; hostKeySha256: string | null };

export function isServerStorageEndpoint(
  server: BoundEndpoint & { host: string; port: number; operatingSystem: string },
  node: BoundEndpoint & { host: string | null; port: number | null },
) {
  if (node.teamId !== server.teamId || (node.host != null && node.host.toLowerCase() !== server.host.toLowerCase())) {
    return false;
  }
  // Windows stores the profile's verified OpenSSH port on the bound node. The
  // server's own port is RDP. An override trusting another SSH key is a separate endpoint.
  if (server.operatingSystem === "WINDOWS") {
    return Boolean(server.hostKeySha256) && (!node.hostKeySha256 || node.hostKeySha256 === server.hostKeySha256);
  }
  return node.port == null || node.port === server.port;
}
