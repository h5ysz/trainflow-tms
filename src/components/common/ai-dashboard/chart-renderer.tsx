"use client";

// GCCLAB AI Copilot — Phase 3 — Chart Renderer
// =====================================================================
// Renders any ChartDataset (bar/line/pie/comparison) using recharts.
// Auto-adapts to dark/light theme via CSS variables.
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, Area, AreaChart, PieChart, Pie, Cell, Legend, ComposedChart,
} from "recharts";
import type { ChartDataset } from "@/lib/ai/analytics/types";
import { CHART_COLORS } from "@/lib/ai/analytics/charts";

interface ChartRendererProps {
  dataset: ChartDataset;
  height?: number;
}

export function ChartRenderer({ dataset, height = 300 }: ChartRendererProps) {
  // Transform series data into recharts-compatible shape
  // For bar/line: [{ label: "Jan", series1: 100, series2: 200 }, ...]
  // For pie: [{ name: "Valid", value: 100, color: "#7c3aed" }, ...]
  if (dataset.type === "pie") {
    const pieData = (dataset.series[0]?.data ?? []).map((d, i) => ({
      name: d.label,
      value: d.value,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    return (
      <div>
        <h4 className="text-sm font-semibold mb-2">{dataset.title}</h4>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name}: ${e.value}`}>
              {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // For bar/line/comparison: merge series into rows by label
  const labels = Array.from(new Set(dataset.series.flatMap((s) => s.data.map((d) => d.label))));
  const data = labels.map((label) => {
    const row: Record<string, unknown> = { label };
    for (const s of dataset.series) {
      const point = s.data.find((d) => d.label === label);
      row[s.name] = point?.value ?? 0;
    }
    return row;
  });

  const fmtTick = (v: number) => {
    if (dataset.unit === "currency") return `${(v / 1000).toFixed(0)}k`;
    if (dataset.unit === "percent") return `${v}%`;
    return String(v);
  };

  if (dataset.type === "line") {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-2">{dataset.title}</h4>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtTick} />
            <Tooltip formatter={(v: unknown) => formatTooltip(Number(v), dataset)} />
            <Legend />
            {dataset.series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (dataset.type === "area") {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-2">{dataset.title}</h4>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtTick} />
            <Tooltip formatter={(v: unknown) => formatTooltip(Number(v), dataset)} />
            <Legend />
            {dataset.series.map((s, i) => (
              <Area key={s.name} type="monotone" dataKey={s.name} stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.3} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // bar + comparison
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">{dataset.title}</h4>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtTick} />
          <Tooltip formatter={(v: unknown) => formatTooltip(Number(v), dataset)} />
          <Legend />
          {dataset.series.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTooltip(v: number, dataset: ChartDataset): string {
  if (dataset.unit === "currency") return `${v.toLocaleString()} ${dataset.currency ?? "SAR"}`;
  if (dataset.unit === "percent") return `${v}%`;
  return String(v);
}

// ─── Forecast Chart (special — renders historical + forecast with CI) ──────
interface ForecastChartProps {
  series: import("@/lib/ai/analytics/types").ForecastSeries;
  height?: number;
}

export function ForecastChart({ series, height = 280 }: ForecastChartProps) {
  const data = series.points.map((p) => ({
    label: p.label,
    historical: p.historical ?? null,
    forecast: p.forecast ?? null,
    lower: p.lower ?? null,
    upper: p.upper ?? null,
  }));
  const fmtTick = (v: number) => {
    if (series.unit === "currency") return `${(v / 1000).toFixed(0)}k`;
    if (series.unit === "percent") return `${v}%`;
    return String(v);
  };
  const fmtTooltip = (v: number) => {
    if (series.unit === "currency") return `${v.toLocaleString()} ${series.currency ?? "SAR"}`;
    if (series.unit === "percent") return `${v}%`;
    return String(v);
  };
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">{series.label}</h4>
        <span className="text-xs text-muted-foreground">{series.method}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtTick} />
          <Tooltip formatter={(v: unknown) => v === null || v === undefined ? "—" : fmtTooltip(Number(v))} />
          <Legend />
          {/* Confidence interval as a faint area */}
          {series.points.some((p) => p.lower !== undefined) && (
            <Area type="monotone" dataKey="upper" stroke="none" fill="#7c3aed" fillOpacity={0.08} name="Upper bound" />
          )}
          {series.points.some((p) => p.lower !== undefined) && (
            <Area type="monotone" dataKey="lower" stroke="none" fill="#7c3aed" fillOpacity={0.08} name="Lower bound" />
          )}
          <Line type="monotone" dataKey="historical" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} name="Historical" connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Forecast" connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{series.unit === "currency" ? `${series.currency ?? "SAR"}` : series.unit === "percent" ? "%" : ""}</span>
        <span>·</span>
        <span>Confidence: {Math.round(series.confidence * 100)}%</span>
      </div>
    </div>
  );
}
