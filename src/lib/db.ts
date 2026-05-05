import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
  var __whrkhldsbPrisma__: PrismaClient | undefined;
  var __whrkhldsbPrismaAdapter__: PrismaPg | undefined;
}

function getPrismaAdapter() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  if (!global.__whrkhldsbPrismaAdapter__) {
    global.__whrkhldsbPrismaAdapter__ = new PrismaPg(process.env.DATABASE_URL);
  }

  return global.__whrkhldsbPrismaAdapter__;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: getPrismaAdapter(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getPrismaClient() {
  if (!global.__whrkhldsbPrisma__) {
    global.__whrkhldsbPrisma__ = createPrismaClient();
  }

  return global.__whrkhldsbPrisma__;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    return Reflect.get(client, property, receiver);
  },
});
