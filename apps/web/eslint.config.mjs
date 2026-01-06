import nextConfig from "@repo/eslint-config/nextjs";

const config = [
  ...nextConfig,
  {
    ignores: ["**/node_modules/**", "**/.next/**"],
  },
];

export default config;
