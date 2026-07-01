import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
		rules: {
			"react-hooks/set-state-in-effect": "warn",
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": ["warn", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			}],
		},
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.cjs", "prisma/migrations/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // csrfFetch intentionally uses `any` as generic default — it's a flexible fetch wrapper
  // where return type depends on the API endpoint and cannot be statically typed.
  {
    files: ["src/lib/auth/csrf-client.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // (localStorage reads, theme/locale initialization, CSRF token loading).
  // These patterns are legitimate React initialization and the rule gives false positives.
  {
    files: [
      "src/lib/auth/csrf-client.ts",
      "src/lib/i18n/use-locale.ts",
      "src/lib/theme/use-theme.ts",
      "src/components/global-search.tsx",
      "src/components/notification-bell.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  // Suppress for useEffect that intentionally initializes state from localStorage on mount
  {
    files: [
      "src/app/ai/ai-client.tsx",
      "src/app/docker/page.tsx",
      "src/app/image-bed/page.tsx",
      "src/app/monitoring/page.tsx",
      "src/app/preferences/page.tsx",
      "src/app/quick-services/quick-services-client.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    "_test_*.js",
  ]),
]);

export default eslintConfig;
