import "server-only";
import { existsSync } from "fs";
import { join } from "path";

// Arabic in generated PDFs.
//
// pdfkit's built-in Helvetica is a WinAnsi-encoded standard font: it has no Arabic
// glyphs at all, so every Arabic string on a certificate rendered as blank boxes or
// mangled Latin-1. An embedded TrueType font fixes this properly — pdfkit lays out
// embedded fonts through fontkit, which applies the OpenType shaping Arabic requires
// to join letterforms.
//
// No suitable font ships with this repository (licence-wise it has to be chosen
// deliberately), so Arabic is opt-in: drop a TTF at the path below and every generated
// PDF starts rendering Arabic. Until then the PDFs are English-only, which is correct
// output rather than broken output.
//
//   public/fonts/NotoNaskhArabic-Regular.ttf     (SIL Open Font License)
//   https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic

const ARABIC_FONT_RELATIVE = join("public", "fonts", "NotoNaskhArabic-Regular.ttf");

let cached: string | null | undefined;

/**
 * Absolute path to the Arabic font, or null when it has not been installed.
 * Resolved once per process — the answer cannot change without a redeploy.
 */
export function arabicFontPath(): string | null {
  if (cached !== undefined) return cached;

  // Under `output: "standalone"` the server runs from .next/standalone, where the
  // postbuild step copies public/ alongside it; in dev, cwd is the project root.
  const candidates = [
    join(process.cwd(), ARABIC_FONT_RELATIVE),
    join(process.cwd(), "..", "..", ARABIC_FONT_RELATIVE),
  ];

  cached = candidates.find((p) => existsSync(p)) ?? null;
  if (!cached) {
    console.warn(
      `[pdf] Arabic font not found at ${ARABIC_FONT_RELATIVE}; generated PDFs will omit Arabic text. ` +
        "Install a Noto Naskh Arabic TTF at that path to enable it."
    );
  }
  return cached;
}

export function hasArabicFont(): boolean {
  return arabicFontPath() !== null;
}
