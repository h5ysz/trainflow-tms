"use client";

// GCCLAB AI Copilot — Phase 2 — Action Preview Card
// =====================================================================
// Renders the non-mutating preview returned by /actions/preview.
// Shows:
//   - Action title + summary
//   - Affected records table
//   - Field-level changes (old → new)
//   - Warnings (color-coded by level)
//   - Expected result
//   - Confirm / Cancel buttons
//
// On Confirm → calls /actions/execute with the previewToken.
// On Cancel → calls onDismiss.
//
// During execution, shows progress (especially for multi-step workflows).
// After execution, shows the success/failure result + a "Done" button.
import { useState } from "react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (mirror src/lib/ai/actions/types.ts) ───────────────────────────
interface AffectedRecord {
  entity: string;
  refNumber?: string | null;
  description: string;
}
interface FieldChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}
interface Warning {
  level: "info" | "warning" | "danger";
  message: string;
  messageAr?: string;
}
export interface PreviewResult {
  actionType: string;
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  affectedRecords: AffectedRecord[];
  changes: FieldChange[];
  warnings: Warning[];
  expectedResult: string;
  expectedResultAr: string;
  hydratedParams: Record<string, unknown>;
  steps?: { key: string; label: string; labelAr?: string }[];
}
export interface ExecuteResult {
  success: boolean;
  actionType: string;
  message: string;
  messageAr?: string;
  results?: Array<{ entity: string; id?: string; refNumber?: string; description: string }>;
  stepResults?: Array<{ key: string; success: boolean; message: string; refNumber?: string }>;
}

type Locale = "en" | "ar";

interface Props {
  preview: PreviewResult;
  previewToken: string;
  locale: Locale;
  onDismiss: () => void;
  onExecuted?: (result: ExecuteResult) => void;
}

type Phase = "PREVIEW" | "EXECUTING" | "DONE";

export function ActionPreviewCard({ preview, previewToken, locale, onDismiss, onExecuted }: Props) {
  const [phase, setPhase] = useState<Phase>("PREVIEW");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, ar?: string) => (locale === "ar" && ar ? ar : en);

  const handleConfirm = async () => {
    setPhase("EXECUTING");
    setError(null);
    try {
      const res = await api.post<{ success: boolean; data: ExecuteResult }>("/copilot/actions/execute", { previewToken });
      setResult(res.data);
      setPhase("DONE");
      if (res.data.success) onExecuted?.(res.data);
    } catch (e) {
      setError((e as Error).message || "Execution failed");
      setPhase("DONE");
    }
  };

  // ─── EXECUTING phase ──────────────────────────────────────────────────
  if (phase === "EXECUTING") {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3 shadow-sm" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {t("Preparing Action...", "جاري التحضير للإجراء...")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {preview.summary}
        </p>
        {preview.steps && (
          <div className="space-y-1.5">
            {preview.steps.map((step) => (
              <div key={step.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t(step.label, step.labelAr)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── DONE phase ───────────────────────────────────────────────────────
  if (phase === "DONE" && (result || error)) {
    const success = result?.success && !error;
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3 shadow-sm" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex items-start gap-2">
          {success ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              {success ? t("Completed", "اكتمل") : t("Failed", "فشل")}
            </div>
            <p className="text-xs text-muted-foreground mt-1 break-words">
              {error ?? (result ? t(result.message, result.messageAr) : "")}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Multi-step workflow results */}
        {result?.stepResults && result.stepResults.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t">
            {result.stepResults.map((step) => (
              <div key={step.key} className="flex items-start gap-2 text-xs">
                {step.success ? (
                  <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-600 shrink-0 mt-0.5" />
                )}
                <span className="break-words">{step.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Entity results */}
        {result?.results && result.results.length > 0 && (
          <div className="space-y-1 pt-2 border-t">
            <div className="text-xs font-medium text-muted-foreground">{t("Affected records", "السجلات المتأثرة")}</div>
            {result.results.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px]">{r.entity}</Badge>
                {r.refNumber && <span className="font-mono text-[10px]">{r.refNumber}</span>}
                <span className="text-muted-foreground truncate">{r.description}</span>
              </div>
            ))}
            {result.results.length > 10 && (
              <div className="text-[10px] text-muted-foreground">+{result.results.length - 10} more</div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={onDismiss}>{t("Done", "تم")}</Button>
        </div>
      </div>
    );
  }

  // ─── PREVIEW phase ────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 shadow-sm" dir={locale === "ar" ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="text-[10px] font-mono">{preview.actionType}</Badge>
          </div>
          <h4 className="text-sm font-semibold">{t(preview.title, preview.titleAr)}</h4>
          <p className="text-xs text-muted-foreground mt-1">{t(preview.summary, preview.summaryAr)}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={onDismiss}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div className="space-y-1.5">
          {preview.warnings.map((w, i) => (
            <Alert key={i} className={cn("py-2", warningClass(w.level))}>
              <div className="flex items-start gap-2">
                {w.level === "danger" ? <XCircle className="h-3 w-3 mt-0.5" /> :
                  w.level === "warning" ? <AlertTriangle className="h-3 w-3 mt-0.5" /> :
                  <Info className="h-3 w-3 mt-0.5" />}
                <AlertDescription className="text-xs">{t(w.message, w.messageAr)}</AlertDescription>
              </div>
            </Alert>
          ))}
        </div>
      )}

      {/* Affected records */}
      {preview.affectedRecords.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{t("Affected records", "السجلات المتأثرة")}</div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {preview.affectedRecords.slice(0, 20).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px] shrink-0">{r.entity}</Badge>
                {r.refNumber && <span className="font-mono text-[10px] shrink-0">{r.refNumber}</span>}
                <span className="text-muted-foreground truncate">{r.description}</span>
              </div>
            ))}
            {preview.affectedRecords.length > 20 && (
              <div className="text-[10px] text-muted-foreground">+{preview.affectedRecords.length - 20} more</div>
            )}
          </div>
        </div>
      )}

      {/* Changes */}
      {preview.changes.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{t("Changes", "التغييرات")}</div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {preview.changes.slice(0, 30).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground shrink-0 w-24 truncate">{t(c.label)}</span>
                <span className="font-mono text-[10px] text-muted-foreground line-through shrink-0 max-w-[80px] truncate">
                  {formatValue(c.oldValue)}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="font-mono text-[10px] text-foreground font-medium truncate">
                  {formatValue(c.newValue)}
                </span>
              </div>
            ))}
            {preview.changes.length > 30 && (
              <div className="text-[10px] text-muted-foreground">+{preview.changes.length - 30} more</div>
            )}
          </div>
        </div>
      )}

      {/* Workflow steps preview */}
      {preview.steps && preview.steps.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{t("Workflow steps", "خطوات سير العمل")}</div>
          <ol className="text-xs space-y-1 list-decimal list-inside">
            {preview.steps.map((s, i) => (
              <li key={i} className="text-muted-foreground">{t(s.label, s.labelAr)}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Expected result */}
      <div className="rounded-md bg-muted/40 p-2">
        <div className="text-[10px] font-medium text-muted-foreground mb-0.5">{t("Expected result", "النتيجة المتوقعة")}</div>
        <p className="text-xs">{t(preview.expectedResult, preview.expectedResultAr)}</p>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-1 border-t">
        <Button size="sm" variant="outline" onClick={onDismiss}>
          {t("Cancel", "إلغاء")}
        </Button>
        <Button size="sm" onClick={handleConfirm}>
          {t("Confirm", "تأكيد")}
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function warningClass(level: "info" | "warning" | "danger"): string {
  switch (level) {
    case "danger": return "border-red-500/50 bg-red-50 text-red-900";
    case "warning": return "border-amber-500/50 bg-amber-50 text-amber-900";
    default: return "border-blue-500/50 bg-blue-50 text-blue-900";
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    // ISO date strings → readable
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      try { return new Date(v).toLocaleDateString(); } catch { /* ignore */ }
    }
    return v.length > 30 ? v.slice(0, 30) + "…" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}
