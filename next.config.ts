import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build. This was previously set to ignore them, which meant a
  // type regression anywhere in src/ shipped silently; the errors it was actually
  // hiding were in scripts/seed-demo.ts and a dead examples/ directory, both since
  // fixed or removed.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // pdfkit reads its built-in AFM font metrics off disk relative to __dirname.
  // Bundling it rewrites __dirname, so it looks for /ROOT/node_modules/pdfkit/...
  // and every PDF request fails with ENOENT. Keep it external.
  //
  // qrcode and nodemailer both use conditional/dynamic requires that the bundler
  // resolves incorrectly (qrcode pulls in a CLI-only yargs dependency; nodemailer
  // resolves transports at runtime), so they get the same treatment.
  serverExternalPackages: ["pdfkit", "qrcode", "nodemailer"],
};

export default nextConfig;
