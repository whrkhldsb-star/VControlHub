/**
 * ITSM/IM connection service public API (FEAT-ITSM-IM-BIDI).
 *
 * Implementations are split by responsibility while this barrel preserves the
 * stable @/lib/itsm/service import path used by routes, ticket fan-out, and tests.
 */
export {
  createItsmConnection,
  deleteItsmConnection,
  getItsmConnection,
  listItsmConnections,
  listItsmEvents,
  updateItsmConnection,
} from "./service-connections";
export {
  fanOutTicketEvent,
  safeFanOutTicketEvent,
  testItsmConnection,
} from "./service-outbound";
export { handleInboundWebhook } from "./service-inbound";
