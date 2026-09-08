import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import jest from "eslint-plugin-jest";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/**", "**/.yarn/**", "**/dummy/**", "**/_LOCAL/**"]),
  {
    files: ["**/*.{js,cjs,mjs,ts,cts,mts}"],

    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      importPlugin.flatConfigs.errors,
      importPlugin.flatConfigs.typescript,
    ],

    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      jest,
      "simple-import-sort": simpleImportSort,
    },

    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: "./tsconfig.json",
          alwaysTryTypes: true,
        }),
      ],
    },

    rules: {
      "object-shorthand": "error",

      // If something might be async in future, using `await`
      // guarantees it will return a promise.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          args: "after-used",
          ignoreRestSiblings: true,
        },
      ],

      // We know how to JavaScript.
      "@typescript-eslint/unbound-method": "off",

      curly: "error",
      "no-console": "error",
      "no-else-return": "off",
      "no-return-assign": ["error", "except-parens"],
      "no-underscore-dangle": "off",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      camelcase: "off",
      "prefer-arrow-callback": [
        "error",
        {
          allowNamedFunctions: true,
        },
      ],
      "class-methods-use-this": "off",
      "no-restricted-syntax": "off",
      "no-param-reassign": [
        "error",
        {
          props: false,
        },
      ],

      "arrow-body-style": "off",
      "no-nested-ternary": "off",

      /*
       * simple-import-sort seems to be the most stable import sorting
       * currently; disable others.
       */
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "sort-imports": "off",
      "import-x/order": "off",

      "import-x/no-deprecated": "warn",
      "import-x/no-duplicates": "error",
    },
  },

  {
    files: ["__tests__/**/*.ts", "src/__mocks__/**/*.ts"],

    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "import-x/no-duplicates": "off",
    },
  },

  {
    files: ["scripts/*.js"],

    // Disables the type-aware rules and parser configuration together.
    extends: [tseslint.configs.disableTypeChecked],

    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/prefer-includes": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/prefer-string-starts-ends-with": "off",
    },
  },

  // Must come last so that it can disable conflicting formatting rules.
  prettier,
);
