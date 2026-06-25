import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the multi-stage Docker image (04-03).
  output: "standalone",
};

export default nextConfig;
