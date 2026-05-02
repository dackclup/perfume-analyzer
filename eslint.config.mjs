// ESLint 9 flat config. Lints the inline <script> blocks inside the
// two HTML pages plus the helper Node tools. Keeps the rule surface
// small — the codebase is intentionally a single-file SPA, so this
// file enforces hygiene (no-unused-vars, eqeqeq) without rewriting
// established style.
//
// Audit-r2 Tier 2 (F5): scripts/ (Round-1 CLIs) + tests/ + lib/ now
// linted under the same rule surface. Previously only tools/ was
// covered; the 6 scripts/ CLIs and the 4 lib/ modules slipped past
// the gate.
import globals from "globals";
import htmlPlugin from "@html-eslint/eslint-plugin";
import htmlParser from "@html-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "audit/**",
      "perfumery_data.js",
      "formulation_data.js",
      "formulation_engine.js",
      "sw.js",
    ],
  },
  // HTML files: lint inline <script> via the html plugin.
  {
    files: ["**/*.html"],
    plugins: { "@html-eslint": htmlPlugin },
    languageOptions: { parser: htmlParser },
    rules: {
      "@html-eslint/require-doctype": "error",
      "@html-eslint/require-lang": "error",
      "@html-eslint/no-duplicate-id": "error",
      "@html-eslint/no-multiple-h1": "error",
      "@html-eslint/require-img-alt": "warn",
    },
  },
  // Node helper scripts (tools/ + scripts/ — same rule surface).
  {
    files: ["tools/**/*.{js,mjs}", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
      eqeqeq: ["error", "smart"],
    },
  },
  // Browser-targeted ES modules in lib/ — `window`, `localStorage` are valid globals.
  {
    files: ["lib/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      eqeqeq: ["error", "smart"],
    },
  },
  // Vitest unit tests — run in Node with vitest globals injected.
  {
    files: ["tests/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      eqeqeq: ["error", "smart"],
    },
  },
];
