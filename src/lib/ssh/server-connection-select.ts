import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

/**
 * Everything buildSshParamsFromServer decides with: where to connect, how to
 * authenticate, whether the server is Agent-managed or Windows (no SSH
 * commands), and the saved host-key pin. A projection missing one of these
 * picked another path without a compile error.
 */
export const SSH_CONNECTION_SERVER_SELECT = {
  id: true,
  host: true,
  port: true,
  username: true,
  operatingSystem: true,
  connectionType: true,
  managementMode: true,
  sshKeyId: true,
  password: true,
  hostKeySha256: true,
  sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
} as const;
