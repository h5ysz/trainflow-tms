"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/common/status-badge";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BadgeCheck,
  AlertTriangle, GraduationCap, TrendingUp, Award, ArrowRight,
  Building2, BookOpen, QrCode, Plus, Loader2, Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RouteKey } from "@/lib/auth/permissions";
import { api } from "@/lib/api/client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

interface DashboardData {
  kpis: {
    // Sprint 2 new
    pendingRequests: number;
    underReviewRequests: number;
    approvedRequests: number;
    scheduledSessions: number;
    todaySessions: number;
    availableTrainers: number;
    trainerConflicts: number;
    companies: number;
    trainees: number;
    // Existing
    totalSessions: number;
    sessionsThisYear: number;
    activeTrainees: number;
    issuedCertificates: number;
    certsThisYear: number;
    expiringCerts: number;
    activeTrainers: number;
    completionRate: number | null;
    avgScore: number | null;
  };
  charts: {
    sessionsByMonth: { month: string; count: number }[];
    requestsByStatus: { status: string; count: number }[];
    certificatesByCourse: { course: string; count: number }[];
  };
  upcomingSessions: Array<{
    id: string; sessionCode?: string; refNumber?: string; title: string;
    courseTitle?: string | null; courseCode?: string | null;
    trainerName?: string | null; startDate: string; endDate: string; status: string;
  }>;
  recentActivity: Array<{
    id: string; action: string; entity: string;
    description: string; userName?: string | null; createdAt: string;
  }>;
}

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#94a3b8"];

function KpiCard({ label, value, icon: Icon, accent, trend, hint }: {
  label: string; value: string | number; icon: LucideIcon;
  accent: string; trend?: string; hint?: string;
}) {
  return (
    <Card className="p-4 tf-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</div>
          <div className="mt-1.5 text-2xl font-bold text-foreground tabular-nums">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
          {trend && (
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-success">
              <TrendingUp className="h-3 w-3" />{trend}
            </div>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0", accent)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function ChartCard({ title, icon: Icon, children, hint }: {
  title: string; icon: LucideIcon; children: React.ReactNode; hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      </div>
      {children ?? <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function DashboardRoute() {
  const { t } = useI18n();
  const { user, navigate } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/dashboard")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (!user) return null;

  const quickActions: { label: string; icon: LucideIcon; route: RouteKey; accent: string }[] = [
    { label: t("companies.new"), icon: Building2, route: "companies", accent: "bg-success/10 text-success" },
    { label: t("requests.new"), icon: ClipboardList, route: "requests", accent: "bg-warning/10 text-warning" },
    { label: t("sessions.new"), icon: CalendarDays, route: "sessions", accent: "bg-info/10 text-info" },
    { label: t("qr.title"), icon: QrCode, route: "qr-code", accent: "bg-primary/10 text-primary" },
  ];

  const kpis = data?.kpis;
  const charts = data?.charts;

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <Card className="p-5 sm:p-6 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RoleBadge role={user.role} className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold">
              {t("dashboard.welcome", { name: user.fullName.split(" ")[0] })}
            </h2>
            <p className="text-sm text-primary-foreground/85 mt-1 max-w-xl">
              {t("dashboard.welcomeSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickActions.slice(0, 2).map((qa) => (
              <Button
                key={qa.route}
                variant="secondary"
                className="bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25 border-0 backdrop-blur"
                onClick={() => navigate(qa.route)}
              >
                <Plus className="h-4 w-4 me-1" />
                {qa.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card className="p-4 text-sm text-destructive">{error}</Card>
      ) : (
        <>
          {/* KPI grid — Sprint 2 expanded */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Sprint 2 new KPIs */}
            <KpiCard label={t("dashboard.kpi.pendingRequests")} value={kpis?.pendingRequests ?? 0} icon={ClipboardList} accent="bg-warning/10 text-warning" />
            <KpiCard label={t("dashboard.kpi.underReviewRequests")} value={kpis?.underReviewRequests ?? 0} icon={ClipboardList} accent="bg-info/10 text-info" />
            <KpiCard label={t("dashboard.kpi.approvedRequests")} value={kpis?.approvedRequests ?? 0} icon={Check} accent="bg-success/10 text-success" />
            <KpiCard label={t("dashboard.kpi.scheduledSessions")} value={kpis?.scheduledSessions ?? 0} icon={CalendarDays} accent="bg-info/10 text-info" />
            <KpiCard label={t("dashboard.kpi.todaySessions")} value={kpis?.todaySessions ?? 0} icon={CalendarDays} accent="bg-primary/10 text-primary" />
            <KpiCard label={t("dashboard.kpi.availableTrainers")} value={kpis?.availableTrainers ?? 0} icon={GraduationCap} accent="bg-success/10 text-success" />
            <KpiCard label={t("dashboard.kpi.trainerConflicts")} value={kpis?.trainerConflicts ?? 0} icon={AlertTriangle} accent={kpis?.trainerConflicts ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"} />
            <KpiCard label={t("dashboard.kpi.companies")} value={kpis?.companies ?? 0} icon={Building2} accent="bg-info/10 text-info" />
            <KpiCard label={t("dashboard.kpi.trainees")} value={kpis?.trainees ?? 0} icon={Users} accent="bg-success/10 text-success" />
            {/* Existing KPIs */}
            <KpiCard label={t("dashboard.kpi.totalSessions")} value={kpis?.totalSessions ?? 0} icon={CalendarDays} accent="bg-info/10 text-info" hint={`${kpis?.sessionsThisYear ?? 0} this year`} />
            <KpiCard label={t("dashboard.kpi.issuedCertificates")} value={kpis?.issuedCertificates ?? 0} icon={BadgeCheck} accent="bg-primary/10 text-primary" hint={`${kpis?.certsThisYear ?? 0} this year`} />
            <KpiCard label={t("dashboard.kpi.expiringCerts")} value={kpis?.expiringCerts ?? 0} icon={AlertTriangle} accent="bg-warning/10 text-warning" />
            <KpiCard label={t("dashboard.kpi.activeTrainers")} value={kpis?.activeTrainers ?? 0} icon={GraduationCap} accent="bg-info/10 text-info" />
            <KpiCard label={t("dashboard.kpi.completionRate")} value={kpis?.completionRate !== null ? `${kpis?.completionRate ?? 0}%` : "—"} icon={TrendingUp} accent="bg-success/10 text-success" />
            <KpiCard label={t("dashboard.kpi.avgScore")} value={kpis?.avgScore !== null ? `${kpis?.avgScore ?? 0}%` : "—"} icon={Award} accent="bg-primary/10 text-primary" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={t("dashboard.chart.sessionsByMonth")} icon={TrendingUp}>
              {charts && charts.sessionsByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={224}>
                  <LineChart data={charts.sessionsByMonth.map((s) => ({ month: s.month.slice(5), count: s.count }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-56 flex flex-col items-center justify-center text-center rounded-md border border-dashed">
                  <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <div className="text-xs text-muted-foreground max-w-xs">{t("misc.pageUnderConstruction")}</div>
                </div>
              )}
            </ChartCard>

            <ChartCard title={t("dashboard.chart.requestsByStatus")} icon={ClipboardList}>
              {charts && charts.requestsByStatus.length > 0 && charts.requestsByStatus.some((r) => r.count > 0) ? (
                <ResponsiveContainer width="100%" height={224}>
                  <BarChart data={charts.requestsByStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="status" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-56 flex flex-col items-center justify-center text-center rounded-md border border-dashed">
                  <ClipboardList className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <div className="text-xs text-muted-foreground max-w-xs">{t("misc.pageUnderConstruction")}</div>
                </div>
              )}
            </ChartCard>
          </div>

          {/* Certificates by course pie chart */}
          {charts && charts.certificatesByCourse.length > 0 && (
            <ChartCard title={t("dashboard.chart.certificatesByCourse")} icon={BadgeCheck}>
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie data={charts.certificatesByCourse} dataKey="count" nameKey="course" cx="50%" cy="50%" outerRadius={80} label={(e) => e.course}>
                    {charts.certificatesByCourse.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Quick actions + activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">{t("dashboard.quickActions")}</h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((qa) => (
                  <button
                    key={qa.route}
                    onClick={() => navigate(qa.route)}
                    className="flex flex-col items-start gap-2 p-3 rounded-lg border hover:border-primary/40 hover:bg-muted/50 transition-colors text-start"
                  >
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", qa.accent)}>
                      <qa.icon className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-medium">{qa.label}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{t("dashboard.recentActivity")}</h3>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("audit-log")}>
                  {t("dashboard.viewAll")}
                  <ArrowRight className="h-3 w-3 ms-1 rtl:rotate-180" />
                </Button>
              </div>
              {data?.recentActivity && data.recentActivity.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto tf-scroll">
                  {data.recentActivity.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/30">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs shrink-0">
                        <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{a.description}</div>
                        <div className="text-[10px] text-muted-foreground">{a.userName} · {new Date(a.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <LayoutDashboard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                  <div className="text-sm text-muted-foreground">{t("misc.pageUnderConstruction")}</div>
                </div>
              )}
            </Card>
          </div>

          {/* Upcoming sessions */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{t("dashboard.upcomingSessions")}</h3>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("sessions")}>
                {t("dashboard.viewAll")}
                <ArrowRight className="h-3 w-3 ms-1 rtl:rotate-180" />
              </Button>
            </div>
            {data?.upcomingSessions && data.upcomingSessions.length > 0 ? (
              <div className="space-y-2">
                {data.upcomingSessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/30">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-info/10 text-info shrink-0">
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="font-mono">{s.sessionCode}</span>
                        {s.courseTitle && <span>· {s.courseTitle}</span>}
                        {s.trainerName && <span>· {s.trainerName}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-end shrink-0">
                      <div>{new Date(s.startDate).toLocaleDateString()}</div>
                      <div>{new Date(s.startDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <div className="text-sm text-muted-foreground">{t("misc.pageUnderConstruction")}</div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
