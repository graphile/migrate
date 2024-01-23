module.exports = {
  parser: "@typescript-eslint/parser",
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/errors",
    "plugin:import/typescript",
    "prettier",
  ],
  plugins: ["jest", "@typescript-eslint", "simple-import-sort", "import"],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
    project: "tsconfig.json",
  },
  env: {
    node: true,
    jest: true,
    es6: true,
  },
  rules: {
    "object-shorthand": "error",

    // If something might be async in future, using `await` guarantees it will return a promise
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
    // We know how to JavaScript
    "@typescript-eslint/unbound-method": "off",
    curly: "error",
    "no-console": "error",
    "no-else-return": 0,
    "no-return-assign": [2, "except-parens"],
    "no-underscore-dangle": 0,
    "jest/no-focused-tests": 2,
    "jest/no-identical-title": 2,
    camelcase: 0,
    "prefer-arrow-callback": [
      "error",
      {
        allowNamedFunctions: true,
      },
    ],
    "class-methods-use-this": 0,
    "no-restricted-syntax": 0,
    "no-param-reassign": [
      "error",
      {
        props: false,
      },
    ],

    "arrow-body-style": 0,
    "no-nested-ternary": 0,

    /*
     * simple-import-sort seems to be the most stable import sorting currently,
     * disable others
     */
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "sort-imports": "off",
    "import/order": "off",

    "import/no-deprecated": "warn",
    "import/no-duplicates": "error",
  },
  overrides: [
    {
      files: ["__tests__/**/*.ts", "src/__mocks__/**/*.ts"],
      rules: {
        "no-console": "warn",
        "@typescript-eslint/ban-ts-ignore": "off",
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
        "import/no-duplicates": "off",
      },
    },
    {
      files: ["scripts/*.js"],
      parserOptions: {
        project: null,
      },
      rules: {
        "@typescript-eslint/await-thenable": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-misused-promises": "off",
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
        "@typescript-eslint/prefer-includes": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/prefer-regexp-exec": "off",
        "@typescript-eslint/prefer-string-starts-ends-with": "off",
        "@typescript-eslint/no-base-to-string": "off",
        "@typescript-eslint/no-duplicate-type-constituents": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-implied-eval": "off",
        "@typescript-eslint/no-redundant-type-constituents": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-enum-comparison": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/restrict-plus-operands": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
      },
    },
  ],
};
