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

/** Prisma unique-constraint helper shared by storage upsert/create races. */
export function isUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return code === "P2002" || /Unique constraint/i.test(String(error));
}

declare global {
	var __appPrisma__: PrismaClient | undefined;
	var __appPrismaAdapter__: PrismaPg | undefined;
}

function getPrismaAdapter() {
	if (!global.__appPrismaAdapter__) {
		const url = new URL(config.db.url);
		const poolOption = (name: string, fallback: number, minimum = 1) => {
			const raw = url.searchParams.get(name);
			const value = raw === null ? fallback : Number(raw);
			if (!Number.isSafeInteger(value) || value < minimum) {
				throw new Error(`Invalid database pool option: ${name}`);
			}
			return value;
		};
		// pg.Pool ignores Prisma-style URL pool parameters. Pass driver options
		// explicitly, preserving existing URL overrides and the connection cap.
		global.__appPrismaAdapter__ = new PrismaPg({
			connectionString: url.toString(),
			max: Math.min(
				poolOption("pool_max", config.db.poolSize),
				poolOption("connection_limit", config.db.connectionLimit),
			),
			idleTimeoutMillis: poolOption("pool_idle_timeout", config.db.poolIdleTimeoutMs, 0),
		});
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
