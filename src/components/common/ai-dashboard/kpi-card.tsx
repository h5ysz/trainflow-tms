"use client";

// GCCLAB AI Copilot — Phase 3 — KPI Card
// =====================================================================
// Animated KPI card with delta indicator + sparkline support.
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  label: string;
  labelAr?: string;
  value: number | string;
  format: "number" | "currency" | "percentage" | "date" | "text";
  currency?: string;
  deltaPercent?: number | null;
  deltaLabel?: string;
  deltaLabelAr?: string;
  tone: "default" | "positive" | "negative" | "warning" | "info";
  icon?: string;
  locale: "en" | "ar";
}

const TONE_STYLES: Record<KpiCardProps["tone"], string> = {
  default: "border-border bg-card",
  positive: "border-green-500/30 bg-green-50/50 dark:bg-green-950/20",
  negative: "border-red-500/30 bg-red-50/50 dark:bg-red-950/20",
  warning: "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20",
  info: "border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20",
};

export function KpiCard({ label, labelAr, value, format, currency, deltaPercent, deltaLabel, deltaLabelAr, tone, locale }: KpiCardProps) {
  const formatted = formatValue(value, format, currency);
  const showDelta = deltaPercent !== null && deltaPercent !== undefined;
  const deltaPositive = (deltaPercent ?? 0) > 0;
  const deltaNegative = (deltaPercent ?? 0) < 0;
  const displayLabel = locale === "ar" && labelAr ? labelAr : label;
  const displayDelta = locale === "ar" && deltaLabelAr ? deltaLabelAr : deltaLabel;

  return (
    <div className={cn("rounded-xl border p-4 transition-all hover:shadow-md", TONE_STYLES[tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-muted-foreground truncate">{displayLabel}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">{formatted}</div>
        </div>
      </div>
      {showDelta && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {deltaPositive ? (
            <TrendingUp className="h-3 w-3 text-green-600" />
          ) : deltaNegative ? (
            <TrendingDown className="h-3 w-3 text-red-600" />
          ) : (
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
          <span className={cn("font-medium", deltaPositive ? "text-green-600" : deltaNegative ? "text-red-600" : "text-muted-foreground")}>
            {deltaPercent! > 0 ? "+" : ""}{deltaPercent}%
          </span>
          {displayDelta && <span className="text-muted-foreground truncate">· {displayDelta}</span>}
        </div>
      )}
    </div>
  );
}

function formatValue(value: number | string, format: string, currency?: string): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency ?? "SAR"}`;
    case "percentage":
      return `${value}%`;
    case "number":
      return value.toLocaleString();
    case "date":
      return new Date(value).toLocaleDateString();
    default:
      return String(value);
  }
}
