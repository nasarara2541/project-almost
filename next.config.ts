import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the hot-reload cache separate from production builds. Sharing one
  // directory can corrupt Turbopack when a build and dev server overlap.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  async redirects() {
    return [
      {
        source: "/more",
        destination: "/",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
