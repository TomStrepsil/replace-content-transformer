import rootConfig from "../../../eslint.config.js";

export default [
  ...rootConfig,
  {
    files: ["lean-search-strategy.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^regex-partial-match(?!/(features|hitEnd)$)",
              allowTypeImports: true,
              message:
                "LeanRegexSearchStrategy must not bundle a PartialMatchRegExp class; only search-strategy.ts may import one at run time."
            }
          ]
        }
      ]
    }
  }
];
