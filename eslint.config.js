import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

export default defineConfig([
  globalIgnores([
    ".npm-cache/",
    "coverage/",
    "**/dist/",
    "packages/db/generated/",
  ]),
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{js,jsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]);
