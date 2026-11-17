import type { NextConfig } from "next";

const config: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.SOKOSOO_DJANGO_URL || "http://127.0.0.1:8010"}/api/:path*/` }];
  },
};

export default config;
