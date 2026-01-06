import tseslint from "typescript-eslint";

const config = tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);

export default config;
