import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the multi-stage Docker image (04-03).
  output: "standalone",
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          // Allow the SW to control all routes under the origin.
          { key: "Service-Worker-Allowed", value: "/" },
          // Always revalidate so browsers pick up new SW versions immediately.
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
