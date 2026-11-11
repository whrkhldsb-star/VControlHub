/**
 * Statuses the gateway sends when its own session policy ends a desktop
 * (runtime.rdpIdleTimeoutSec, runtime.rdpMaxSessionSec). Client-safe.
 *
 * They lie outside the codes Guacamole assigns: a status guacd reports itself
 * (0x0308 for a browser that stopped answering, 0x020A for Windows' own idle
 * limit) keeps its meaning, and the page can tell "the platform ended this
 * desktop" from a dropped connection, which it reconnects.
 */
export const RDP_STATUS_IDLE_LIMIT = 0x0a01;
export const RDP_STATUS_TIME_LIMIT = 0x0a02;
