import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vivaha/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:4100/api/:path*" }];
  },
};

export default nextConfig;
