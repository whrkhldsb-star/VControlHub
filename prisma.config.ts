import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { defineConfig, env } from "prisma/config";

const envFiles = [resolve(process.cwd(), ".env"), resolve(process.cwd(), ".env.local")].filter((path) => existsSync(path));

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
  },
});
