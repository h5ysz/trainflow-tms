// ─────────────────────────────────────────────────────────────────────────────
// Course material text extraction — feeds the AI Question Generator.
// ─────────────────────────────────────────────────────────────────────────────
// Reads the uploaded Course Material files from disk (via their `storagePath`)
// and extracts their real text content:
//
//   - PDF        → pdfjs-dist (modern pdf.js text layer; handles pdfkit output
//                  that the ancient pdf-parse@1.1.1 / pdf.js v1.10 failed on)
//   - DOCX       → mammoth (raw text of the document body)
//   - PPTX       → JSZip + the slide XML parts (ppt/slides/slideN.xml)
//
// There is deliberately NO fallback that guesses or fabricates course content:
// if a file cannot be read, or yields no meaningful text, extraction throws and
// the caller surfaces the real reason to the trainer. The AI Question Generator
// must only ever build questions from text that actually came out of the file.
//
// MAX_SOURCE_CHARS caps the prompt size for the LLM context window — it truncates
// the *real* extracted text, it never substitutes invented content.
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import JSZip from "jszip";
import { courseMaterialsDir } from "@/lib/api/course-materials";

/** Minimum meaningful text a material must yield for question generation. */
export const MIN_EXTRACTED_CHARS = 20;

/** Maximum characters of extracted text sent to the LLM (real text, truncated). */
export const MAX_SOURCE_CHARS = 120_000;

/** Extractable material kinds (only uploaded files have real content). */
export type ExtractableMaterialType = "PDF" | "POWERPOINT" | "WORD";

export class MaterialExtractionError extends Error {
  readonly code = "EXTRACTION_FAILED";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripXmlTags(xml: string): string {
  // Replace block-ish tags with a space so words from adjacent elements don't merge.
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// ─── Extracted-text cleaning (before it ever reaches the AI) ────────────────
// PDF/DOCX/PPTX extraction frequently carries artifacts that must never leak
// into a generated question or the LLM prompt:
//   - control characters
//   - the replacement char �, box glyphs □ ▪ ■ (broken font encodings)
//   - Private Use Area codepoints (\uF000–\uF8FF etc.) from Word/PDF symbols
//   - long underscore runs (workbook "write here" filler lines)
//   - bare page-number / "........" filler lines
//   - consecutive duplicate header/footer lines (running headers)
// This is text *cleaning*, never content fabrication: we only drop formatting
// noise and normalize whitespace — we never invent words.

const PDF_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PDF_BROKEN_GLYPHS = /[\uFFFD\uFFFE\uFFFF□■▪►]+\s*/g;
const PDF_PUA_CHARS = /[\uE000-\uF8FF\uFDD0-\uFDEF]/g;
const PDF_UNDERSCORE_RUNS = /_{2,}/g;
const PDF_DOT_FILLER = /^[.,•·\s]*$/;

/** Clean raw extracted text: strip PDF/Word artifacts and normalize whitespace. */
export function cleanExtractedText(text: string): string {
  let cleaned = text
    .replace(PDF_CONTROL_CHARS, " ")
    .replace(PDF_BROKEN_GLYPHS, " ")
    .replace(PDF_PUA_CHARS, "")
    .replace(PDF_UNDERSCORE_RUNS, " ")
    // Typographic punctuation → plain ASCII so downstream tooling matches reliably.
    .replace(/[“”‘’]/g, (m) => (m === "“" || m === "”" ? '"' : "'"))
    .replace(/[–—]/g, "-");

  // Drop filler lines (page numbers, dot-leaders) and consecutive duplicate
  // lines (running headers/footers) — pure formatting noise.
  const lines: string[] = [];
  let previous = "";
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (PDF_DOT_FILLER.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue; // bare page number
    if (line === previous) continue; // repeated header/footer
    previous = line;
    lines.push(line);
  }

  return normalizeWhitespace(lines.join("\n"));
}

/** Locate the pdfjs-dist package dir at runtime (dev + standalone build). */
export function resolvePdfjsDir(): string {
  const candidates = [path.join(process.cwd(), "node_modules", "pdfjs-dist")];
  // Standalone build output copies server deps under .next/standalone/node_modules.
  const viaRequire = createRequire(import.meta.url);
  try {
    candidates.push(path.dirname(viaRequire.resolve("pdfjs-dist/package.json")));
  } catch {
    /* cwd-relative path is used as a fallback below */
  }
  for (const candidate of candidates) {
    if (candidate && !candidate.includes("[project]") && !candidate.includes("[externals]")) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * pdf.js's Node "fake worker" normally loads the worker via a dynamic
 * `import(workerSrc)`. Under webpack that import is rewritten to a virtual
 * chunk path ("Setting up fake worker failed") — so instead we statically
 * import the real worker module once and expose it on globalThis.pdfjsWorker,
 * which pdf.js's `#mainThreadWorkerMessageHandler` detects and uses directly.
 */
let pdfjsWorkerPromise: Promise<unknown> | null = null;
export function loadPdfjsWorker(): Promise<unknown> {
  if (!pdfjsWorkerPromise) {
    pdfjsWorkerPromise = import("pdfjs-dist/legacy/build/pdf.worker.mjs")
      .then((mod) => {
        globalThis.pdfjsWorker = mod as typeof globalThis.pdfjsWorker;
        return mod;
      })
      .catch((e) => {
        pdfjsWorkerPromise = null;
        throw e;
      });
  }
  return pdfjsWorkerPromise;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf.js's Node factory loads fonts with fs.promises.readFile(url) where
  // url = baseUrl + filename; a file:// URL string fails on Windows (readFile
  // wants a plain path), so pass a plain filesystem path with trailing sep.
  const pdfjsDir = resolvePdfjsDir();
  const standardFontDataUrl = path.join(pdfjsDir, "standard_fonts") + path.sep;

  // Make the worker available on the main thread so pdf.js skips the dynamic
  // worker import entirely (see loadPdfjsWorker above).
  await loadPdfjsWorker();

  const task = getDocument({ data: new Uint8Array(buffer), standardFontDataUrl });
  const doc = await task.promise;
  const parts: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
  } finally {
    await doc.destroy();
  }
  return normalizeWhitespace(parts.join("\n"));
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value);
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/i.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml/i.exec(b)?.[1] ?? 0);
      return na - nb;
    });

  if (entries.length === 0) {
    throw new MaterialExtractionError("No slides found in the PowerPoint file (not a valid PPTX).");
  }

  const parts: string[] = [];
  for (const entry of entries) {
    const file = zip.files[entry];
    if (!file || file.dir) continue;
    const xml = await file.async("text");
    const text = stripXmlTags(decodeXmlEntities(xml));
    if (text) parts.push(text);
  }
  return normalizeWhitespace(parts.join("\n\n"));
}

/**
 * Extract the real text of an uploaded course material from its on-disk
 * storagePath. Throws MaterialExtractionError when the file is missing,
 * unsupported, or contains no meaningful text — never guesses content.
 */
export async function extractMaterialText(material: {
  id: string;
  type: string;
  storagePath?: string | null;
  fileName?: string | null;
}): Promise<{ text: string; type: ExtractableMaterialType; fileName: string | null }> {
  if (!material.storagePath) {
    throw new MaterialExtractionError(`Material "${material.fileName ?? material.id}" has no stored file (external resource, not an upload).`);
  }

  const type = material.type as ExtractableMaterialType;
  if (type !== "PDF" && type !== "POWERPOINT" && type !== "WORD") {
    throw new MaterialExtractionError(`File type "${material.type}" cannot be used as a source for AI questions.`);
  }

  const dir = path.resolve(courseMaterialsDir());
  // Defence in depth: storagePath is written by the server (random hex name), but
  // never let a crafted path escape the materials directory.
  if (material.storagePath.includes("..") || path.isAbsolute(material.storagePath)) {
    throw new MaterialExtractionError("Invalid storage path.");
  }
  const fullPath = path.resolve(dir, material.storagePath.replace(/^course-materials[/\\]/, ""));
  if (!fullPath.startsWith(dir + path.sep)) {
    throw new MaterialExtractionError("Invalid storage path.");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch {
    throw new MaterialExtractionError(`Could not read stored file for "${material.fileName ?? material.id}" — it may have been deleted.`);
  }

  if (buffer.length === 0) {
    throw new MaterialExtractionError(`File "${material.fileName ?? material.id}" is empty.`);
  }

  let text: string;
  try {
    if (type === "PDF") {
      text = await extractPdfText(buffer);
    } else if (type === "WORD") {
      text = await extractDocxText(buffer);
    } else {
      text = await extractPptxText(buffer);
    }
  } catch (e) {
    if (e instanceof MaterialExtractionError) throw e;
    throw new MaterialExtractionError(
      `Could not extract text from "${material.fileName ?? material.id}" (${type}). ` +
        `The file may be corrupted, scanned/image-only, or password-protected.`,
    );
  }

  if (!text || text.trim().length < MIN_EXTRACTED_CHARS) {
    throw new MaterialExtractionError(
      `No meaningful text could be extracted from "${material.fileName ?? material.id}". ` +
        "Scanned or image-only files cannot be used for AI question generation.",
    );
  }

  // Strip PDF/Word formatting artifacts (broken glyphs, PUA symbols, underline
  // filler, running headers, page numbers) so the LLM sees clean source text.
  const cleaned = cleanExtractedText(text);

  return {
    text: cleaned.slice(0, MAX_SOURCE_CHARS),
    type,
    fileName: material.fileName ?? null,
  };
}

/**
 * Extract text from several materials at once; keeps per-material attribution.
 * Fails fast with a combined message if ANY selected material cannot be read —
 * the trainer should fix the file rather than silently generating from a subset.
 */
export async function extractMaterialsText(
  materials: Array<{ id: string; type: string; storagePath?: string | null; fileName?: string | null }>,
): Promise<Array<{ id: string; text: string; type: ExtractableMaterialType; fileName: string | null }>> {
  const results: Array<{ id: string; text: string; type: ExtractableMaterialType; fileName: string | null }> = [];
  for (const m of materials) {
    const extracted = await extractMaterialText(m);
    results.push({ id: m.id, text: extracted.text, type: extracted.type, fileName: extracted.fileName });
  }
  return results;
}
