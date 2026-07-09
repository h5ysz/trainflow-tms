import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdfkit reads its built-in AFM font metrics off disk relative to __dirname.
  // Bundling it rewrites __dirname, so it looks for /ROOT/node_modules/pdfkit/...
  // and every PDF request fails with ENOENT. Keep it external.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
