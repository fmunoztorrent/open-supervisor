// Flat ESLint config (ESLint v10) for the open-supervisor monorepo.
//
// Baseline: this codebase had no lint setup (the `lint` scripts called `eslint`
// but it was never installed nor configured, so CI's "Run lint" step always
// failed with "eslint: not found"). This config makes `pnpm lint` actually run
// and pass. Rules are intentionally lenient (warnings, not errors) so the lint
// gate is green on previously-unlinted code; tighten them incrementally.

import tseslint from "typescript-eslint"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.config.{js,cjs,mjs,ts}",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/vendor/**",
    ],
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.node, ...globals.jest, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    // Lenient baseline — warnings only (exit 0). Promote to "error" over time.
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-var": "warn",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // react-hooks registered so inline disable directives in the mobile app
      // resolve (otherwise ESLint v10 errors with "rule not found").
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]
