// Copies the assets Next's standalone output does not include into .next/standalone.
//
// `next build` with `output: "standalone"` traces server dependencies but deliberately
// leaves `.next/static` and `public/` out, on the assumption they are served by a CDN.
// This project serves them from the same process, so they have to be copied in.
//
// Previously this was `cp -r ...` chained onto the build script, which does not exist on
// Windows: the build appeared to succeed while producing a standalone server with no CSS,
// no client JS and no images.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(
    "✗ .next/standalone not found. Run `next build` with output: \"standalone\" first."
  );
  process.exit(1);
}

const copies = [
  { from: join(root, ".next", "static"), to: join(standalone, ".next", "static") },
  { from: join(root, "public"), to: join(standalone, "public") },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.log(`   → skipped (missing): ${from}`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`   ✓ ${from} → ${to}`);
}

console.log("✓ Standalone assets copied.");
