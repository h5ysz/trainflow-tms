/**
 * Cloudinary upload utility — server-side only.
 *
 * Uses the Cloudinary API Key + API Secret from environment variables.
 * NEVER expose these to the client — this module is only imported by
 * Next.js API routes (server-side).
 *
 * The upload uses Cloudinary's signed upload API, which requires the
 * API Secret. The resulting URL is a public CDN URL that can be opened
 * from any device (desktop, mobile) without authentication.
 *
 * Old files stored on disk (/api/uploads/...) continue to work —
 * this module is only used for NEW uploads. The upload endpoints
 * try Cloudinary first, and fall back to disk if Cloudinary is not
 * configured (e.g. during local development without env vars).
 */

import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary from environment variables.
// These are set in .env (local) and Render's Environment tab (production).
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface CloudinaryUploadResult {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

/**
 * Check if Cloudinary is configured (env vars present).
 * Used by upload endpoints to decide whether to use Cloudinary or
 * fall back to disk storage.
 */
export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Upload a file to Cloudinary using signed upload.
 *
 * @param buffer — the file content as a Buffer
 * @param filename — original filename (for display)
 * @param mime — MIME type (image/png, image/jpeg, application/pdf, etc.)
 * @param folder — Cloudinary folder (e.g. "trainee-docs", "request-docs")
 * @returns CloudinaryUploadResult with the CDN URL
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  filename: string,
  mime: string,
  folder: string,
): Promise<CloudinaryUploadResult> {
  // Upload using the data URI approach — works with buffers from FormData.
  const result = await cloudinary.uploader.upload(`data:${mime};base64,${buffer.toString("base64")}`, {
    folder: `gcclab/${folder}`,
    resource_type: mime.startsWith("image/") ? "image" : "raw",
    // Use a random public_id so files don't collide.
    // Cloudinary generates a random ID if public_id is not set.
    overwrite: false,
    // Return the URL in a CDN-optimized format.
    transformation: mime.startsWith("image/") ? [{ quality: "auto", fetch_format: "auto" }] : undefined,
  });

  return {
    url: result.secure_url,
    filename: filename,
    size: result.bytes,
    mime: mime,
  };
}

/**
 * Delete a file from Cloudinary by its URL.
 * Extracts the public_id from the URL and calls the destroy API.
 *
 * @param url — the Cloudinary CDN URL
 * @returns true if deleted, false if not found or error
 */
export async function deleteFromCloudinary(url: string): Promise<boolean> {
  try {
    // Cloudinary URLs look like:
    // https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{folder}/{public_id}.{ext}
    // We need to extract: {folder}/{public_id} (without extension)
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return false;

    const publicId = match[1].replace(/\.[^.]+$/, ""); // Remove file extension
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: url.includes("/raw/upload/") ? "raw" : "image",
    });
    return result.result === "ok";
  } catch {
    return false;
  }
}

/**
 * Check if a URL is a Cloudinary URL.
 * Used to determine whether to use Cloudinary delete or disk delete.
 */
export function isCloudinaryUrl(url: string): boolean {
  return url.includes("res.cloudinary.com");
}
