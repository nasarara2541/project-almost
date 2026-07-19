import type { NextConfig } from "next";

/**
 * WebContainers (the in-browser Node.js runtime used for live previews)
 * requires the page to be cross-origin isolated. Without these headers the
 * container silently fails to boot, so they are applied to every route.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
