import { config as loadEnv } from "dotenv";
import { ensureBudgetDeliveryTable } from "../src/lib/cost/budget-deliveries";
import { prisma } from "../src/lib/db";

loadEnv({ path: [".env.runtime", ".env.local", ".env"], quiet: true });
ensureBudgetDeliveryTable({ backfill: true }).catch(error => {
	console.error(error);
	process.exitCode = 1;
}).finally(() => prisma.$disconnect());
