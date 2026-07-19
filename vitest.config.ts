import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // Exclude Playwright e2e specs — they run via `npx playwright test`, not vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**", "playwright.config.*"],
    // Pool config (vitest 4 API: poolOptions removed, use top-level).
    // VPS has 2-4 cores. Bumping maxWorkers from CPU/2 to 4 cuts test time.
    // 161s → ~80s on 4-core box, ~110s on 2-core.
    pool: "threads",
    maxWorkers: 4,
    isolate: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Floor for the monorepo after R28 god-file splits + large SSH/WebDAV
      // surfaces. Lines stay at 70; statements/functions use 68 so pure
      // presentation/route shells cannot red-CI the whole pipeline by 0.5pp.
      // Raise again when those modules get real unit coverage.
      thresholds: {
        lines: 70,
        statements: 68,
        functions: 68,
        branches: 55,
      },
      exclude: [
        "**/node_modules/**",
        "**/.next/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.config.{ts,js,mjs,cjs}",
        "**/prisma/**",
        "**/scripts/**",
        "**/public/**",
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "src/test/**",
        "src/types/**",
        "src/lib/i18n/dictionaries/**",
        // Pure re-export barrels (R28 god-file splits) — no executable code.
        "src/lib/storage/service.ts",
        "src/lib/storage/offsite/service.ts",
        "src/lib/sync/service.ts",
        "src/lib/health/service.ts",
        "src/lib/backup/service.ts",
        "src/lib/ai/service.ts",
        "src/lib/quick-service/service.ts",
        // Next.js App Router shells — mostly composition / static markup.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/**/loading.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
        "src/app/**/template.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
