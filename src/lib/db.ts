import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { config } from "@/lib/config/env";

export function isDatabaseUnavailableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return /P1001|Can't reach database server|PrismaClientInitializationError|database server|driver adapter|accelerateUrl|engine type\s+["']?client["']?\s+requires|ECONNREFUSED|connect ECONNREFUSED|Connection terminated unexpectedly|connection error/i.test(
    message,
  );
}

declare global {
	var __appPrisma__: PrismaClient | undefined;
	var __appPrismaAdapter__: PrismaPg | undefined;
}

function getPrismaAdapter() {
	if (!global.__appPrismaAdapter__) {
		// `config.db.url` throws with a clear "Missing required env var: DATABASE_URL"
		// message if unset — equivalent to the old check.
		const url = new URL(config.db.url);
		// Ensure pool params are in the connection string for the pg adapter
		if (!url.searchParams.has("pool_max")) {
			url.searchParams.set("pool_max", String(config.db.poolSize));
		}
		if (!url.searchParams.has("pool_idle_timeout")) {
			url.searchParams.set("pool_idle_timeout", String(config.db.poolIdleTimeoutMs));
		}
		global.__appPrismaAdapter__ = new PrismaPg(url.toString());
	}

	return global.__appPrismaAdapter__;
}

function createPrismaClient() {
	return new PrismaClient({
		adapter: getPrismaAdapter(),
		log: config.isDevelopment ? ["warn", "error"] : ["error"],
	});
}

function getPrismaClient() {
	if (!global.__appPrisma__) {
		global.__appPrisma__ = createPrismaClient();
	}

	return global.__appPrisma__;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    return Reflect.get(client, property, receiver);
  },
});
