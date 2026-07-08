"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/common/status-badge";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BadgeCheck,
  AlertTriangle, GraduationCap, TrendingUp, Award, ArrowRight,
  Building2, BookOpen, QrCode, FileCheck2, Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RouteKey } from "@/lib/auth/permissions";

function KpiCard({
  label, value, icon: Icon, accent, trend, hint,
}: {
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
              <TrendingUp className="h-3 w-3" />
              {trend}
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

function ChartPlaceholder({ title, icon: Icon, hint }: { title: string; icon: LucideIcon; hint: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      </div>
      <div className="h-56 flex flex-col items-center justify-center text-center rounded-md border border-dashed">
        <Icon className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <div className="text-xs text-muted-foreground max-w-xs">{hint}</div>
      </div>
    </Card>
  );
}

export function DashboardRoute() {
  const { t } = useI18n();
  const { user, navigate } = useAppStore();

  if (!user) return null;

  const quickActions: { label: string; icon: LucideIcon; route: RouteKey; accent: string }[] = [
    { label: t("companies.new"), icon: Building2, route: "companies", accent: "bg-success/10 text-success" },
    { label: t("requests.new"), icon: ClipboardList, route: "requests", accent: "bg-warning/10 text-warning" },
    { label: t("sessions.new"), icon: CalendarDays, route: "sessions", accent: "bg-info/10 text-info" },
    { label: t("qr.title"), icon: QrCode, route: "qr-code", accent: "bg-primary/10 text-primary" },
  ];

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

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label={t("dashboard.kpi.totalSessions")} value="0" icon={CalendarDays} accent="bg-info/10 text-info" />
        <KpiCard label={t("dashboard.kpi.activeTrainees")} value="0" icon={Users} accent="bg-success/10 text-success" />
        <KpiCard label={t("dashboard.kpi.pendingRequests")} value="0" icon={ClipboardList} accent="bg-warning/10 text-warning" />
        <KpiCard label={t("dashboard.kpi.issuedCertificates")} value="0" icon={BadgeCheck} accent="bg-primary/10 text-primary" />
        <KpiCard label={t("dashboard.kpi.expiringCerts")} value="0" icon={AlertTriangle} accent="bg-warning/10 text-warning" />
        <KpiCard label={t("dashboard.kpi.activeTrainers")} value="0" icon={GraduationCap} accent="bg-info/10 text-info" />
        <KpiCard label={t("dashboard.kpi.completionRate")} value="—" icon={TrendingUp} accent="bg-success/10 text-success" />
        <KpiCard label={t("dashboard.kpi.avgScore")} value="—" icon={Award} accent="bg-primary/10 text-primary" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartPlaceholder
          title={t("dashboard.chart.sessionsByMonth")}
          icon={TrendingUp}
          hint={t("misc.pageUnderConstruction")}
        />
        <ChartPlaceholder
          title={t("dashboard.chart.requestsByStatus")}
          icon={ClipboardList}
          hint={t("misc.pageUnderConstruction")}
        />
      </div>

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
          <div className="py-8 text-center">
            <LayoutDashboard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <div className="text-sm text-muted-foreground">{t("misc.pageUnderConstruction")}</div>
          </div>
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
        <div className="py-8 text-center">
          <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <div className="text-sm text-muted-foreground">{t("misc.pageUnderConstruction")}</div>
        </div>
      </Card>
    </div>
  );
}
