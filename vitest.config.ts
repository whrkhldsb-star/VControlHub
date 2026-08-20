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
    // Keep the suite reliable on two-vCPU CI runners. Four V8 coverage workers
    // oversubscribe them and make timer-driven user-event and bcrypt tests
    // cross the 5s test timeout despite passing alone. Developers can still
    // override this through the Vitest CLI on a larger machine.
    pool: "threads",
    maxWorkers: 2,
    isolate: true,
    // Full V8 coverage on the small CI runners can briefly pause jsdom/user-event
    // and bcrypt work. Keep the default long enough to avoid false negatives while
    // still failing genuinely stuck tests promptly.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Layered floors:
      // - Global: monorepo floor after R28 splits + large SSH/WebDAV surfaces.
      // - src/lib/**: higher bar for business logic (enforced when coverage
      //   is collected for those files).
      // Route shells (page/layout/loading) are excluded from the denominator.
      thresholds: {
        lines: 70,
        statements: 68,
        functions: 68,
        branches: 55,
        // Domain logic floor — monorepo lib currently ~69% statements overall
        // (SSH/WebDAV/sync packages pull it down). Keep a soft bar below the
        // measured aggregate so pure-helper regressions still fail CI.
        "src/lib/**/*.{ts,tsx}": {
          lines: 68,
          statements: 68,
          functions: 65,
          branches: 50,
        },
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
