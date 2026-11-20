// Abort a stalled SFTP transfer (remote stops sending/ACKing) so it can't hang
// forever — keepalive only detects a fully dead TCP connection, not a live
// connection whose bytes simply stopped flowing. The clock resets on every
// chunk, so a slow-but-progressing large transfer is never killed. Matches the
// bound already applied in downloads' transferFileViaSsh2.
export const SFTP_TRANSFER_IDLE_TIMEOUT_MS = 120_000;
