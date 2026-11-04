import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// dotenv keeps the first value it sees, so the most specific file comes first:
// the service's own .env.runtime, then .env.local (the installer's file), then
// .env. The old order let .env override .env.local (A10-03).
const envFiles = [".env.runtime", ".env.local", ".env"].map((name) => resolve(process.cwd(), name)).filter((path) => existsSync(path));

if (envFiles.length > 0) {
  loadDotenv({ path: envFiles, quiet: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "npm run prisma:seed",
  },
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
