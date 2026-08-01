// GCCLAB AI Copilot — Phase 3 — Analytics types
// =====================================================================
// Shared types for the analytics engine. All pure functions; no React.
import type { UserRole } from "@/lib/auth/permissions";

// ─── Access scope ─────────────────────────────────────────────────────────
// Resolved from the requesting user. Drives every analytics query so that
// contractors only see their own data, coordinators see operational data,
// and super admins see everything.
export interface AnalyticsScope {
  role: UserRole;
  userId: string;
  companyId: string | null;
  // True for SUPER_ADMIN + COORDINATOR — they see org-wide financial data.
  canSeeFinancial: boolean;
  // True for SUPER_ADMIN + COORDINATOR + TRAINER — they see operational data.
  canSeeOperational: boolean;
}

// ─── Time range ───────────────────────────────────────────────────────────
export interface TimeRange {
  from: Date;
  to: Date;
}

export type RangePreset = "7d" | "30d" | "90d" | "ytd" | "12m" | "all";

export function rangeFromPreset(preset: RangePreset): TimeRange {
  const now = new Date();
  const from = new Date(now);
  switch (preset) {
    case "7d": from.setDate(from.getDate() - 7); break;
    case "30d": from.setDate(from.getDate() - 30); break;
    case "90d": from.setDate(from.getDate() - 90); break;
    case "ytd": from.setMonth(0); from.setDate(1); from.setHours(0, 0, 0, 0); break;
    case "12m": from.setFullYear(from.getFullYear() - 1); break;
    case "all": from.setFullYear(2000, 0, 1); break;
  }
  return { from, to: now };
}

// ─── KPIs ──────────────────────────────────────────────────────────────────
export interface KpiCard {
  key: string;
  label: string;
  labelAr: string;
  value: number | string;
  format: "number" | "currency" | "percentage" | "date" | "text";
  currency?: string;
  // Optional delta vs previous period (e.g. revenue +18% MoM)
  deltaPercent?: number | null;
  deltaLabel?: string;
  deltaLabelAr?: string;
  // Optional sparkline data for the KPI card
  spark?: number[];
  // Visual tone
  tone: "default" | "positive" | "negative" | "warning" | "info";
  icon?: string; // lucide icon name
  group: "revenue" | "training" | "trainers" | "contractors" | "certificates" | "risk";
}

export interface KpiGroup {
  group: KpiCard["group"];
  label: string;
  labelAr: string;
  cards: KpiCard[];
}

export interface KpiResult {
  generatedAt: string;
  range: TimeRange;
  groups: KpiGroup[];
}

// ─── Charts ────────────────────────────────────────────────────────────────
export type ChartType = "bar" | "line" | "pie" | "area" | "heatmap" | "comparison";

export interface ChartSeries {
  name: string;
  nameAr?: string;
  color?: string;
  data: Array<{ label: string; value: number; labelAr?: string }>;
}

export interface ChartDataset {
  type: ChartType;
  title: string;
  titleAr: string;
  xLabel?: string;
  yLabel?: string;
  unit?: "currency" | "percent" | "count";
  currency?: string;
  series: ChartSeries[];
  // For heatmap charts: rows × columns matrix
  matrix?: { rowLabels: string[]; colLabels: string[]; values: number[][] };
}

export interface ChartsResult {
  generatedAt: string;
  charts: ChartDataset[];
}

// ─── Recommendations ───────────────────────────────────────────────────────
export type RecommendationPriority = "critical" | "high" | "medium" | "low";

export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  category: "session" | "trainer" | "contractor" | "financial" | "certificate" | "capacity" | "schedule";
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  // Optional AI action type the user can invoke to act on this recommendation
  actionType?: string;
  actionParams?: Record<string, unknown>;
  // Entity refs for navigation
  entityRefs?: Array<{ entity: string; refNumber: string; description: string }>;
  // Estimated impact (qualitative)
  impact?: "low" | "medium" | "high";
}

export interface RecommendationsResult {
  generatedAt: string;
  recommendations: Recommendation[];
}

// ─── Risks ─────────────────────────────────────────────────────────────────
export type RiskSeverity = "critical" | "high" | "medium" | "low";

export interface Risk {
  id: string;
  severity: RiskSeverity;
  category: "trainer_conflict" | "schedule_conflict" | "cert_expiry" | "late_invoice" | "repeated_failure" | "inactive_contractor" | "low_attendance" | "financial" | "duplicate_trainee" | "capacity";
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  count?: number;
  entityRefs?: Array<{ entity: string; refNumber: string; description: string }>;
  suggestedAction?: string;
}

export interface RisksResult {
  generatedAt: string;
  risks: Risk[];
}

// ─── Forecast ──────────────────────────────────────────────────────────────
export interface ForecastPoint {
  label: string;       // e.g. "2026-09"
  labelAr?: string;
  historical?: number; // actual value (null for future-only points)
  forecast?: number;   // predicted value
  lower?: number;      // confidence interval lower bound
  upper?: number;      // confidence interval upper bound
}

export interface ForecastSeries {
  key: string;
  label: string;
  labelAr: string;
  unit: "currency" | "percent" | "count";
  currency?: string;
  points: ForecastPoint[];
  // Method used (for transparency in the UI)
  method: string;
  methodAr: string;
  // Confidence: 0-1
  confidence: number;
}

export interface ForecastResult {
  generatedAt: string;
  series: ForecastSeries[];
}

// ─── Natural Language Query ────────────────────────────────────────────────
export type NlQueryResultKind = "table" | "chart" | "text" | "kpi";

export interface NlQueryResult {
  kind: NlQueryResultKind;
  // For kind === "text": natural-language answer
  answer?: string;
  answerAr?: string;
  // For kind === "table": rows + columns
  table?: {
    columns: Array<{ key: string; label: string; labelAr?: string; format?: "text" | "number" | "currency" | "percentage" | "date" }>;
    rows: Array<Record<string, unknown>>;
  };
  // For kind === "chart": chart dataset
  chart?: ChartDataset;
  // For kind === "kpi": KPI cards
  kpis?: KpiCard[];
  // Recommendations derived from the query
  recommendations?: Recommendation[];
  // The intent the LLM/system detected
  intent?: string;
  intentAr?: string;
}

// ─── Reports ───────────────────────────────────────────────────────────────
export type ReportFormat = "pdf" | "xlsx" | "docx";

export type ReportType =
  | "monthly" | "quarterly" | "yearly"
  | "trainer" | "contractor" | "financial"
  | "operational" | "attendance" | "exam" | "certificate";

export interface ReportRequest {
  type: ReportType;
  format: ReportFormat;
  range?: RangePreset;
  // For entity-scoped reports (trainer/contractor)
  entityId?: string;
}

export interface ReportResult {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  auditDescription: string;
  auditDescriptionAr: string;
}
