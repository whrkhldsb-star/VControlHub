import type { Prisma } from "@prisma/client";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

/** The persisted endpoint a remote operation was authorized to contact. */
export const SSH_ENDPOINT_IDENTITY_SELECT = {
  host: true, port: true, username: true, hostKeySha256: true, managementMode: true, agentTokenHash: true,
} as const;
export type SshEndpointIdentity = Prisma.ServerGetPayload<{ select: typeof SSH_ENDPOINT_IDENTITY_SELECT }>;

/**
 * Everything buildSshParamsFromServer decides with: where to connect, how to
 * authenticate, whether the server is Agent-managed or Windows (no SSH
 * commands), and the saved host-key pin. A projection missing one of these
 * picked another path without a compile error.
 */
export const SSH_CONNECTION_SERVER_SELECT = {
  id: true,
  teamId: true,
  host: true,
  port: true,
  username: true,
  operatingSystem: true,
  agentTokenHash: true,
  connectionType: true,
  managementMode: true,
  sshKeyId: true,
  password: true,
  hostKeySha256: true,
  sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
} as const;
