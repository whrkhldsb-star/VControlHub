import type { EventEmitter } from "node:events";
import { expect, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

/** guacd answers ready only after the gateway has reauthorized and sent connect. */
export async function guacdHandshake(tunnel: EventEmitter & { write: ReturnType<typeof vi.fn> }, args = instruction("args"), ready = true) {
  tunnel.emit("data", Buffer.from(args));
  await vi.waitFor(() => expect(tunnel.write).toHaveBeenCalledWith(expect.stringContaining("7.connect")));
  if (ready) tunnel.emit("data", Buffer.from(instruction("ready", "tunnel")));
}
