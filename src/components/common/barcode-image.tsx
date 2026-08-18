"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeImageProps {
  value: string;
  className?: string;
  width?: number;
  height?: number;
  fontSize?: number;
}

export function BarcodeImage({ value, className, width = 1.5, height = 40, fontSize = 10 }: BarcodeImageProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: "CODE128",
          width,
          height,
          fontSize,
          displayValue: true,
          margin: 0,
          background: "transparent",
          lineColor: "currentColor",
          textMargin: 2,
          font: "monospace",
        });
      } catch {
        // Invalid barcode value — render nothing
      }
    }
  }, [value, width, height, fontSize]);

  if (!value) return null;

  return <svg ref={svgRef} className={className} />;
}
