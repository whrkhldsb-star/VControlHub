import { Client } from "pg";
import { config } from "@/lib/config/env";
import { getLockKeys, lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { withServerLifecycleLock } from "./lifecycle-lock";

const channel = "vch_terminal_handover";
const namespace = "server-terminal-session";

type Registry = { client: Client; sessions: Map<() => void, string>; alive: boolean };
let connecting: Promise<Registry> | undefined;

// One PostgreSQL session per proxy, including all its detached shells. PostgreSQL counts
// repeated shared acquisitions on that session, and releases them on process death.
async function openRegistry(): Promise<Registry> {
  const client = new Client({ connectionString: config.db.url, connectionTimeoutMillis: 5000 });
  const registry: Registry = { client, sessions: new Map(), alive: true };
  const lost = () => {
    if (!registry.alive) return;
    registry.alive = false;
    connecting = undefined;
    for (const close of [...registry.sessions.keys()]) close();
    registry.sessions.clear();
  };
  client.on("end", lost);
  client.on("error", lost);
  client.on("notification", event => {
    if (event.channel !== channel) return;
    for (const [close, id] of registry.sessions) if (id === event.payload) close();
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${channel}`);
    return registry;
  } catch (error) {
    lost();
    await client.end().catch(() => undefined);
    throw error;
  }
}

export async function closeTerminalRegistry() {
  const registry = await connecting;
  if (registry?.alive) await registry.client.end();
}

/** Register before the final authorization check or opening the transport. */
export function registerTerminalSession(serverId: string, close: () => void) {
  return withServerLifecycleLock(serverId, async () => {
    const registry = await (connecting ??= openRegistry());
    const { k1, k2 } = getLockKeys(namespace, serverId);
    await registry.client.query("SELECT pg_advisory_lock_shared($1,$2)", [k1, k2]);
    if (!registry.alive) throw new Error("Terminal registry disconnected");
    registry.sessions.set(close, serverId);
    return () => {
      if (!registry.sessions.delete(close) || !registry.alive) return;
      void registry.client.query("SELECT pg_advisory_unlock_shared($1,$2)", [k1, k2])
        .catch(() => registry.client.end());
    };
  });
}

/** The caller owns server-delete. Notify on a separate committed connection, then wait for every acknowledgement. */
export async function drainTerminalSessions(serverId: string, tx: Prisma.TransactionClient) {
  await prisma.$executeRaw`SELECT pg_notify(${channel}, ${serverId})`;
  await lockForTransaction(tx, namespace, serverId);
}
