"use client";

import { QRCodeSVG } from "qrcode.react";

interface WorkerQRCodeProps {
  value: string;
  className?: string;
  size?: number;
  level?: "L" | "M" | "Q" | "H";
}

export function WorkerQRCode({ value, className, size = 120, level = "M" }: WorkerQRCodeProps) {
  if (!value) return null;

  return (
    <QRCodeSVG
      value={value}
      size={size}
      level={level}
      bgColor="transparent"
      fgColor="currentColor"
      className={className}
      includeMargin={false}
    />
  );
}
