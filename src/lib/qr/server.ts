import "server-only";
import QRCode from "qrcode";

/**
 * Render a QR code as a PNG buffer, for embedding in generated PDFs.
 *
 * The certificate PDF previously printed the raw verification token as text with a
 * comment promising "in production, generate actual QR image".
 */
export async function renderQrPng(
  text: string,
  opts: { width?: number; margin?: number } = {}
): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: opts.width ?? 240,
    margin: opts.margin ?? 1,
    // M tolerates ~15% damage — appropriate for a printed certificate or door sign.
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}
