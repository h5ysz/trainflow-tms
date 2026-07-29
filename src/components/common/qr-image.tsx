"use client";

// Renders a real, scannable QR code.
//
// What was here before was a 12x12 grid of coloured <div>s seeded from the token's
// character codes — it looked like a QR code and could not be scanned by anything.
// The check-in and certificate-verification features both depended on it.

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/** Generate a PNG data URL at print resolution. Used by the Download button. */
export async function qrPngDataUrl(value: string, width = 1024): Promise<string> {
  return QRCode.toDataURL(value, {
    width,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export function QrImage({
  value,
  size = 256,
  className,
  label,
}: {
  value: string;
  size?: number;
  className?: string;
  /** Accessible name; falls back to the encoded value. */
  label?: string;
}) {
  // Keyed by value, so a change to `value` invalidates the previous render without a
  // synchronous state reset inside the effect.
  const [rendered, setRendered] = useState<{ value: string; svg: string | null; error: boolean } | null>(null);

  // SVG rather than a raster: it prints crisply at any size, and the payload is a
  // machine-generated URL over a hex token, so there is no injection surface.
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((out) => { if (!cancelled) setRendered({ value, svg: out, error: false }); })
      .catch(() => { if (!cancelled) setRendered({ value, svg: null, error: true }); });
    return () => { cancelled = true; };
  }, [value]);

  // Anything rendered for a previous value is stale and must not be shown.
  const current = rendered?.value === value ? rendered : null;
  const svg = current?.svg ?? null;
  const error = current?.error ?? false;

  const style = useMemo(() => ({ width: size, height: size }), [size]);

  if (error || !value) {
    return (
      <div
        style={style}
        className={cn("rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30", className)}
        aria-hidden
      />
    );
  }

  if (!svg) {
    return <div style={style} className={cn("rounded-lg bg-muted animate-pulse", className)} aria-hidden />;
  }

  return (
    <div
      style={style}
      className={cn("rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full", className)}
      role="img"
      aria-label={label ?? value}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
