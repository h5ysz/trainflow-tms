// ─────────────────────────────────────────────────────────────────────────────
// Course material image extraction — real figures for the AI Question Generator
// ─────────────────────────────────────────────────────────────────────────────
// Extracts the actual embedded images of an uploaded PDF material (the same
// pdf.js pipeline the text extractor uses) and saves them as PNG files under
// public/uploads/question-images/<materialId>/, served by the existing
// /api/uploads/[...path] route.
//
// Extraction strategy:
//   - For each scanned page: read the text content AND the operator list.
//   - Every paintImageXObject / paintInlineImageXObject op is a figure drawn on
//     that page; images are resolved lazily by pdf.js via page.objs.get(ref, cb).
//   - Resolves are run concurrently per page with a short timeout — pdf.js only
//     streams an image when it is cheaply available; anything else is skipped
//     rather than blocking generation.
//   - Images are filtered (min size, aspect ratio) and de-duplicated by PNG
//     content hash so repeated headers/logos are stored once.
//   - Each extracted image is tagged with the CLEANED text of its source page so
//     the generator can attach a question to the image whose page text contains
//     the question stem (the stem is a real sentence from the material).
//
// This is deliberately best-effort decoration for the generated questions: a
// PDF with no extractable images simply yields no imageUrl. It never blocks or
// fails question generation, and it never fabricates image content.
//
// Results are cached in a manifest.json keyed by the source file size; replacing
// the material file invalidates the cache (see the [materialId] route).
import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import {
  cleanExtractedText,
  loadPdfjsWorker,
  resolvePdfjsDir,
} from "@/lib/ai/material-extractor";
import { courseMaterialsDir } from "@/lib/api/course-materials";
import type { GeneratedQuestion } from "@/lib/ai/question-generator";

/** Where extracted question images are written (public/uploads by default). */
export function questionImagesDir(): string {
  return process.env.QUESTION_IMAGES_DIR || path.join(process.cwd(), "public", "uploads", "question-images");
}

/** Public URL prefix matching the /api/uploads/[...path] catch-all route. */
export const QUESTION_IMAGES_PREFIX = "/api/uploads/question-images";

/** A single image extracted from a PDF material. */
export interface ExtractedMaterialImage {
  /** Public URL to serve the PNG through /api/uploads/[...path]. */
  url: string;
  /** 1-based page the image was drawn on. */
  page: number;
  width: number;
  height: number;
  /** Cleaned text of the source page, used for relevance matching. */
  pageText: string;
  /** Caption/label line found near the figure (e.g. "Figure 3"). */
  caption?: string;
  /** Text surrounding the figure on its page (the paragraph it belongs to). */
  surroundText?: string;
}

interface ManifestImage {
  url: string;
  page: number;
  width: number;
  height: number;
  pageText: string;
  caption?: string;
  surroundText?: string;
}

interface ImageManifest {
  version: number;
  sourceSize: number;
  images: ManifestImage[];
}

// ─── Limits (bound the cost of a generate request) ──────────────────────────
const MAX_PAGES = 45;
const MAX_UNIQUE_IMAGES = 24;
const MAX_SCAN_MS = 90_000;
const RESOLVE_TIMEOUT_MS = 1_500;
const MANIFEST_VERSION = 2;

// Size filters — drop icons/watermarks (tiny) and thin decorative banners.
const MIN_WIDTH = 100;
const MIN_HEIGHT = 60;
const MAX_ASPECT_BANNER = 4.5;

/**
 * Resolve the on-disk path of an uploaded material, mirroring the safety
 * checks in material-extractor (never let a crafted storagePath escape).
 */
function resolveMaterialPath(material: { id: string; storagePath?: string | null; fileName?: string | null }): string {
  if (!material.storagePath) {
    throw new Error(`Material "${material.fileName ?? material.id}" has no stored file.`);
  }
  if (material.storagePath.includes("..") || path.isAbsolute(material.storagePath)) {
    throw new Error("Invalid storage path.");
  }
  const dir = path.resolve(courseMaterialsDir());
  const fullPath = path.resolve(dir, material.storagePath.replace(/^course-materials[/\\]/, ""));
  if (!fullPath.startsWith(dir + path.sep)) {
    throw new Error("Invalid storage path.");
  }
  return fullPath;
}

/** Count unique words (>=3 chars, stopwords dropped) for page/question matching. */
const STOPWORDS = new Set(
  "the a an and or but not no for with from this that these those are is be was were has have had of in on at to by as it its he she they we you must can will may should would could".split(" "),
);

export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Find the image most likely to belong to a question: the question stem is a
 * real sentence from the material, so the image on the page that contains the
 * most of the stem's words is the figure that sentence describes. Returns null
 * when the match is too weak (no strong page association).
 */
export function bestImageForQuestion(stem: string, images: readonly ExtractedMaterialImage[]): ExtractedMaterialImage | null {
  const stemWords = significantWords(stem);
  if (stemWords.length < 3 || images.length === 0) return null;

  let best: { img: ExtractedMaterialImage; score: number } | null = null;
  for (const img of images) {
    const pageWords = new Set(significantWords(img.pageText));
    if (pageWords.size === 0) continue;
    let hit = 0;
    for (const w of stemWords) {
      if (pageWords.has(w)) hit++;
    }
    const score = hit / stemWords.length;
    if (best === null || score > best.score || (score === best.score && img.page < best.img.page)) {
      best = { img, score };
    }
  }

  return best && best.score >= 0.6 ? best.img : null;
}

/** Attach a relevant extracted image to each question that has a strong page match. */
export function attachMaterialImages(
  questions: GeneratedQuestion[],
  images: readonly ExtractedMaterialImage[],
): GeneratedQuestion[] {
  if (images.length === 0) return questions;
  return questions.map((q) => {
    // A question that already has an explicit imageUrl (model-selected via
    // imageRef) wins — the heuristic must not override it.
    if (q.imageUrl) return q;
    const img = bestImageForQuestion(q.text, images);
    return img ? { ...q, imageUrl: img.url } : q;
  });
}

async function resolvePageImage(
  page: import("pdfjs-dist").PDFPageProxy,
  ref: string | null,
  inline: unknown,
): Promise<{ width: number; height: number; kind: number; data: Uint8Array } | null> {
  const img = await new Promise<{ width: number; height: number; kind: number; data: Uint8Array } | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS);
    try {
      if (inline) {
        clearTimeout(timer);
        const data = (inline as { width?: number; height?: number; kind?: number; data?: Uint8Array });
        resolve(
          data && data.width && data.height && data.data
            ? { width: data.width, height: data.height, kind: data.kind ?? 2, data: data.data }
            : null,
        );
        return;
      }
      page.objs.get(ref as string, (im: { width?: number; height?: number; kind?: number; data?: Uint8Array }) => {
        clearTimeout(timer);
        resolve(im && im.width && im.height && im.data ? { width: im.width, height: im.height, kind: im.kind ?? 2, data: im.data } : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  if (!img) return null;
  // 1-bit mask/stencil images (kind 1) would need bit-unpacking; skip them.
  if (img.kind === 1) return null;
  return img;
}

async function convertToPng(img: { width: number; height: number; kind: number; data: Uint8Array }): Promise<Buffer | null> {
  const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 1;
  const raw = img.data instanceof Uint8Array ? Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) : Buffer.from(img.data);
  try {
    return await sharp(raw, { raw: { width: img.width, height: img.height, channels } }).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * Caption + surrounding-paragraph text of a figure, derived from the PDF text
 * items near the image's drawn rectangle (y from page bottom, PDF units).
 */
function figureContext(
  items: Array<{ x: number; y: number; str: string }>,
  pageText: string,
  x: number,
  y: number,
  dh: number,
): { caption?: string; surroundText?: string } {
  const band = items
    .filter((it) => it.y >= y - 80 && it.y <= y + dh + 80)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let cur: string[] = [];
  let curY: number | null = null;
  for (const it of band) {
    if (curY === null || Math.abs(it.y - curY) < 4) cur.push(it.str);
    else {
      lines.push(cur.join(" "));
      cur = [it.str];
    }
    curY = it.y;
  }
  if (cur.length) lines.push(cur.join(" "));
  const surroundText = (lines.join(" ").trim() || pageText).slice(0, 500);
  const capLine = lines.find((l) => /^(figure|fig\.?|diagram|chart|table|photo|image|لوحة|شكل|صورة|مخطط)\b/i.test(l));
  return { caption: capLine ? capLine.slice(0, 200) : undefined, surroundText };
}

/**
 * Extract the embedded images of a PDF material and persist them as PNGs under
 * public/uploads/question-images/<materialId>/. Returns the extracted image
 * metadata (with cleaned per-page text for relevance matching).
 *
 * Best-effort: non-PDF types, missing files, corrupt PDFs, or PDFs without
 * images all return an empty list — question generation must never depend on
 * image extraction succeeding.
 */
export async function extractMaterialImages(material: {
  id: string;
  type: string;
  storagePath?: string | null;
  fileName?: string | null;
}): Promise<ExtractedMaterialImage[]> {
  if (material.type !== "PDF" || !material.storagePath) return [];

  let fullPath: string;
  let sourceSize: number;
  try {
    fullPath = resolveMaterialPath(material);
    sourceSize = (await fs.stat(fullPath)).size;
  } catch {
    return [];
  }

  const dir = path.join(questionImagesDir(), material.id);
  const manifestPath = path.join(dir, "manifest.json");

  // Cache hit — reuse the previous extraction when the source file is unchanged.
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as ImageManifest;
    if (manifest.version === MANIFEST_VERSION && manifest.sourceSize === sourceSize && Array.isArray(manifest.images) && manifest.images.length > 0) {
      return manifest.images.map((im) => ({
        url: im.url,
        page: im.page,
        width: im.width,
        height: im.height,
        pageText: im.pageText,
        caption: im.caption,
        surroundText: im.surroundText,
      }));
    }
  } catch {
    /* no cache — extract */
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch {
    return [];
  }

  await loadPdfjsWorker();
  const standardFontDataUrl = path.join(resolvePdfjsDir(), "standard_fonts") + path.sep;

  let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
  const collected: ExtractedMaterialImage[] = [];
  const seen = new Set<string>();
  let seq = 0;
  const startMs = Date.now();

  try {
    doc = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl }).promise;
    const pagesToScan = Math.min(doc.numPages, MAX_PAGES);

    for (let p = 1; p <= pagesToScan && collected.length < MAX_UNIQUE_IMAGES && Date.now() - startMs < MAX_SCAN_MS; p++) {
      const page = await doc.getPage(p);

      // Page text — cleaned the same way the text extractor cleans the material
      // text, so question stems (verbatim sentences) match their source page.
      let pageText = "";
      let textItems: Array<{ x: number; y: number; str: string }> = [];
      try {
        const content = await page.getTextContent();
        textItems = content.items
          .map((item) => ({
            str: "str" in item ? item.str : "",
            x: (item as { transform?: number[] }).transform?.[4] ?? 0,
            y: (item as { transform?: number[] }).transform?.[5] ?? 0,
          }))
          .filter((it) => it.str.length > 0);
        pageText = cleanExtractedText(textItems.map((it) => it.str).join(" "));
      } catch {
        /* page text is optional */
      }

      const list = await page.getOperatorList();
      const candidates: Array<{ ref: string | null; inline: unknown; dw: number; dh: number; x: number; y: number }> = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      for (let i = 0; i < list.fnArray.length; i++) {
        const fn = list.fnArray[i];
        const args = list.argsArray[i];
        if (fn === OPS.transform) {
          const [a, b, c, d, e, f] = args as number[];
          ctm = [a * ctm[0] + c * ctm[1], b * ctm[0] + d * ctm[1], a * ctm[2] + c * ctm[3], b * ctm[2] + d * ctm[3], a * ctm[4] + c * ctm[5] + e, b * ctm[4] + d * ctm[5] + f];
          continue;
        }
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject && fn !== OPS.paintImageMaskXObject) continue;
        const dw = Number(args[3]) || 0;
        const dh = Number(args[4]) || 0;
        if (dw > 0 && dh > 0 && (dw < 40 || dh < 25)) continue; // icons / watermark
        if (fn === OPS.paintImageXObject) {
          if (typeof args[0] === "string") candidates.push({ ref: String(args[0]), inline: null, dw, dh, x: ctm[4], y: ctm[5] });
        } else {
          candidates.push({ ref: null, inline: args[0], dw, dh, x: ctm[4], y: ctm[5] });
        }
      }

      const resolved = await Promise.all(
        candidates.map((c) =>
          c.ref ? resolvePageImage(page, c.ref, null) : resolvePageImage(page, null, c.inline),
        ),
      );

      for (let ci = 0; ci < resolved.length; ci++) {
        const img = resolved[ci];
        if (!img) continue;
        if (img.width < MIN_WIDTH || img.height < MIN_HEIGHT) continue;
        if (img.height < 90 && img.width / img.height > MAX_ASPECT_BANNER) continue; // thin banners
        const png = await convertToPng(img);
        if (!png) continue;
        const hash = crypto.createHash("sha256").update(png).digest("hex").slice(0, 24);
        if (seen.has(hash)) continue;
        seen.add(hash);

        seq++;
        const file = `${seq}-p${p}-${img.width}x${img.height}.png`;
        const url = `${QUESTION_IMAGES_PREFIX}/${material.id}/${file}`;
        try {
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, file), png, { flag: "wx" });
        } catch {
          continue;
        }
        const cand = candidates[ci];
        const ctx = figureContext(textItems, pageText, cand.x, cand.y, cand.dh);
        collected.push({ url, page: p, width: img.width, height: img.height, pageText, caption: ctx.caption, surroundText: ctx.surroundText });
      }
    }
  } catch (e) {
    console.error(`[material-images] extraction failed for "${material.fileName ?? material.id}"`, e);
  } finally {
    await doc?.destroy();
  }

  if (collected.length === 0) return [];

  // Persist the manifest for future cache hits.
  try {
    const manifest: ImageManifest = {
      version: MANIFEST_VERSION,
      sourceSize,
      images: collected.map((im) => ({
        url: im.url,
        page: im.page,
        width: im.width,
        height: im.height,
        pageText: im.pageText,
        caption: im.caption,
        surroundText: im.surroundText,
      })),
    };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
  } catch (e) {
    console.error(`[material-images] manifest write failed for "${material.fileName ?? material.id}"`, e);
  }

  return collected;
}
