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
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
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
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
