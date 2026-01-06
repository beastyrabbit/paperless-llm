import baseConfig from "@repo/eslint-config/base";

const config = [
  ...baseConfig,
  {
    ignores: ["**/node_modules/**", "**/dist/**"],
  },
];

export default config;
