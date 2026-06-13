import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app (a parent lockfile exists outside the repo).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
