import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["oidc-provider"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
