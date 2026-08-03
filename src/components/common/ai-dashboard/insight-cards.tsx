"use client";

// GCCLAB AI Copilot — Phase 3 — Recommendation + Risk cards
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, XCircle } from "lucide-react";
import type { Recommendation, Risk } from "@/lib/ai/analytics/types";

const PRIORITY_STYLE: Record<Recommendation["priority"], { color: string; bg: string; icon: typeof AlertTriangle }> = {
  critical: { color: "text-red-700 dark:text-red-400", bg: "border-red-500/40 bg-red-50/60 dark:bg-red-950/30", icon: XCircle },
  high: { color: "text-orange-700 dark:text-orange-400", bg: "border-orange-500/40 bg-orange-50/60 dark:bg-orange-950/30", icon: AlertTriangle },
  medium: { color: "text-amber-700 dark:text-amber-400", bg: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30", icon: AlertCircle },
  low: { color: "text-blue-700 dark:text-blue-400", bg: "border-blue-500/40 bg-blue-50/60 dark:bg-blue-950/30", icon: Info },
};

const SEVERITY_STYLE: Record<Risk["severity"], { color: string; bg: string; icon: typeof AlertTriangle }> = {
  critical: { color: "text-red-700 dark:text-red-400", bg: "border-red-500/40 bg-red-50/60 dark:bg-red-950/30", icon: XCircle },
  high: { color: "text-orange-700 dark:text-orange-400", bg: "border-orange-500/40 bg-orange-50/60 dark:bg-orange-950/30", icon: AlertTriangle },
  medium: { color: "text-amber-700 dark:text-amber-400", bg: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30", icon: AlertCircle },
  low: { color: "text-blue-700 dark:text-blue-400", bg: "border-blue-500/40 bg-blue-50/60 dark:bg-blue-950/30", icon: Info },
};

interface RecommendationCardProps {
  rec: Recommendation;
  locale: "en" | "ar";
  onTakeAction?: (rec: Recommendation) => void;
}

export function RecommendationCard({ rec, locale, onTakeAction }: RecommendationCardProps) {
  const style = PRIORITY_STYLE[rec.priority];
  const Icon = style.icon;
  const title = locale === "ar" ? rec.titleAr : rec.title;
  const desc = locale === "ar" ? rec.descriptionAr : rec.description;
  return (
    <div className={cn("rounded-lg border p-3 flex gap-3", style.bg)}>
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", style.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold">{title}</h4>
          <span className={cn("text-[10px] font-bold uppercase tracking-wide", style.color)}>{rec.priority}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
        {rec.entityRefs && rec.entityRefs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {rec.entityRefs.slice(0, 5).map((e, i) => (
              <span key={i} className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {e.refNumber}
              </span>
            ))}
            {rec.entityRefs.length > 5 && <span className="text-[10px] text-muted-foreground">+{rec.entityRefs.length - 5}</span>}
          </div>
        )}
        {rec.actionType && onTakeAction && (
          <button
            onClick={() => onTakeAction(rec)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {locale === "ar" ? "اتخذ إجراءً" : "Take Action"} →
          </button>
        )}
      </div>
    </div>
  );
}

interface RiskCardProps {
  risk: Risk;
  locale: "en" | "ar";
}

export function RiskCard({ risk, locale }: RiskCardProps) {
  const style = SEVERITY_STYLE[risk.severity];
  const Icon = style.icon;
  const title = locale === "ar" ? risk.titleAr : risk.title;
  const desc = locale === "ar" ? risk.descriptionAr : risk.description;
  return (
    <div className={cn("rounded-lg border p-3 flex gap-3", style.bg)}>
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", style.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold">{title}</h4>
          <span className={cn("text-[10px] font-bold uppercase tracking-wide", style.color)}>{risk.severity}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
        {risk.count !== undefined && risk.count > 0 && (
          <div className="mt-1 text-xs font-medium">{risk.count} item(s)</div>
        )}
        {risk.entityRefs && risk.entityRefs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {risk.entityRefs.slice(0, 5).map((e, i) => (
              <span key={i} className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {e.refNumber}
              </span>
            ))}
            {risk.entityRefs.length > 5 && <span className="text-[10px] text-muted-foreground">+{risk.entityRefs.length - 5}</span>}
          </div>
        )}
        {risk.suggestedAction && (
          <div className="mt-2 text-xs text-muted-foreground">
            {locale === "ar" ? "إجراء مقترح" : "Suggested action"}: <span className="font-mono">{risk.suggestedAction}</span>
          </div>
        )}
      </div>
    </div>
  );
}
