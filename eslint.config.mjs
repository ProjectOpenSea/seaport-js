import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import importPlugin from "eslint-plugin-import";

export default tseslint.config(
  {
    ignores: [
      "lib/**",
      "src/artifacts/**",
      "src/typechain-types/**",
      "cache/**",
      "coverage/**",
      "eslint.config.mjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ["tsconfig.json"],
      },
    },
    rules: {
      "prettier/prettier": "error",
      "no-unused-expressions": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/require-await": "error",
      "object-shorthand": ["error", "always"],
    },
  },
);
