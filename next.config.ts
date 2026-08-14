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
  //
  // pdfjs-dist runs its worker via a dynamic import() inside the legacy bundle;
  // webpack rewrites that to a virtual chunk path that doesn't exist at runtime
  // ("Setting up fake worker failed"). Treating it as external lets pdf.js load
  // its real pdf.worker.mjs + standard_fonts from node_modules as plain Node ESM.
  //
  // sharp ships prebuilt native binaries (@img/sharp-win32-x64 etc.); keep it
  // external so webpack never tries to bundle the .node binary.
  serverExternalPackages: ["pdfkit", "qrcode", "nodemailer", "pdfjs-dist", "sharp"],
};

export default nextConfig;
