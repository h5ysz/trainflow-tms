"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import {
  BarChart3, FileText, Download, FileSpreadsheet, TrendingUp,
  Building2, BookOpen, GraduationCap, CalendarRange, ShieldCheck, UserCheck, Award,
  type LucideIcon,
} from "lucide-react";

interface ReportCard {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
}

export function ReportsRoute() {
  const { t } = useI18n();
  const [reportType, setReportType] = useState("summary");

  const reports: ReportCard[] = [
    { key: "summary", title: t("reports.summary"), desc: t("misc.pageUnderConstruction"), icon: TrendingUp, accent: "bg-primary/10 text-primary" },
    { key: "byCompany", title: t("reports.byCompany"), desc: t("misc.pageUnderConstruction"), icon: Building2, accent: "bg-info/10 text-info" },
    { key: "byCourse", title: t("reports.byCourse"), desc: t("misc.pageUnderConstruction"), icon: BookOpen, accent: "bg-success/10 text-success" },
    { key: "byTrainer", title: t("reports.byTrainer"), desc: t("misc.pageUnderConstruction"), icon: GraduationCap, accent: "bg-warning/10 text-warning" },
    { key: "byPeriod", title: t("reports.byPeriod"), desc: t("misc.pageUnderConstruction"), icon: CalendarRange, accent: "bg-primary/10 text-primary" },
    { key: "compliance", title: t("reports.compliance"), desc: t("misc.pageUnderConstruction"), icon: ShieldCheck, accent: "bg-destructive/10 text-destructive" },
    { key: "attendance", title: t("reports.attendance"), desc: t("misc.pageUnderConstruction"), icon: UserCheck, accent: "bg-info/10 text-info" },
    { key: "scores", title: t("reports.scores"), desc: t("misc.pageUnderConstruction"), icon: Award, accent: "bg-success/10 text-success" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("reports.title")}
        subtitle={t("reports.subtitle")}
        icon={BarChart3}
        actions={
          <div className="flex gap-2">
            <Button variant="outline"><FileText className="h-4 w-4 me-1.5" />{t("reports.exportPdf")}</Button>
            <Button variant="outline"><FileSpreadsheet className="h-4 w-4 me-1.5" />{t("reports.exportExcel")}</Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <FormGrid cols={3}>
          <Field label={t("reports.from")}>
            <Input type="date" />
          </Field>
          <Field label={t("reports.to")}>
            <Input type="date" />
          </Field>
          <Field label={t("reports.title")}>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {reports.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>
        <div className="mt-3 flex justify-end">
          <Button>{t("reports.generate")}</Button>
        </div>
      </Card>

      {/* Report type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {reports.map((r) => (
          <Card key={r.key} className="p-4 tf-card-hover">
            <div className={`flex h-9 w-9 items-center justify-center rounded-md mb-3 ${r.accent}`}>
              <r.icon className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold mb-1">{r.title}</div>
            <div className="text-xs text-muted-foreground line-clamp-2">{r.desc}</div>
          </Card>
        ))}
      </div>

      {/* Report preview */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">{reports.find((r) => r.key === reportType)?.title}</h3>
        </div>
        <EmptyState
          icon={BarChart3}
          title={t("reports.empty.title")}
          subtitle={t("reports.empty.subtitle")}
          className="py-12"
        />
      </Card>
    </div>
  );
}
