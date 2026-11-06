import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal dashboard: every page is rendered per request from the database,
  // so we stay on the classic dynamic model instead of Cache Components.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
