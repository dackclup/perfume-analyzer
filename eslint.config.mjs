// ESLint 9 flat config. Lints the inline <script> blocks inside the
// two HTML pages plus the helper Node tools. Keeps the rule surface
// small — the codebase is intentionally a single-file SPA, so this
// file enforces hygiene (no-unused-vars, eqeqeq) without rewriting
// established style.
import globals from "globals";
import htmlPlugin from "@html-eslint/eslint-plugin";
import htmlParser from "@html-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "perfumery_data.js",
      "perfumery_data.backup.js",
      "formulation_data.js",
      "formulation_engine.js",
      "sw.js"
    ]
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
      "@html-eslint/require-img-alt": "warn"
    }
  },
  // Node helper scripts.
  {
    files: ["tools/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "eqeqeq": ["error", "smart"]
    }
  }
];
