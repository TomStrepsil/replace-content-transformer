import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import vitestGlobals from "eslint-plugin-vitest-globals";
import globals from "globals";

export default [
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.bunBuiltin,
        ...globals.denoBuiltin,
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules
    }
  },
  {
    files: ["**/*.test.ts"],
    plugins: {
      "vitest-globals": vitestGlobals
    },
    languageOptions: {
      globals: {
        ...vitestGlobals.environments.env.globals
      }
    }
  },
  {
    ignores: ["lib/", "node_modules/", "*.js", "coverage/"]
  }
];
