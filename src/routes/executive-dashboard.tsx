"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Building2, Users, UserCheck, Award, ShieldCheck, AlertTriangle,
  Clock, TrendingUp, Plus, FileText, ClipboardCheck, Search, BarChart3,
  Loader2, Building, Calendar, Filter, ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface DashboardData {
  kpis: {
    totalCompanies: number;
    totalWorkers: number;
    activeWorkers: number;
    totalCertificates: number;
    activeCertificates: number;
    expiredCertificates: number;
    expiring7Days: number;
    expiring30Days: number;
    expiring60Days: number;
    expiring90Days: number;
    revokedCertificates: number;
    pendingApprovalCerts: number;
    complianceRate: number;
  };
  charts: {
    certStatus: Array<{ name: string; value: number; color: string }>;
    complianceByCompany: Array<{ name: string; rate: number }>;
    monthlyCertificatesIssued: Array<{ name: string; issued: number }>;
    monthlyRenewals: Array<{ name: string; renewals: number }>;
    topCourses: Array<{ name: string; code: string; count: number }>;
    topCompanies: Array<{ name: string; count: number }>;
    workersMissingMandatory: Array<{ course: string; code: string; missing: number; haveValid: number }>;
  };
  lowestComplianceCompanies: Array<{
    companyId: string; companyName: string; active: number; expired: number; total: number; complianceRate: number;
  }>;
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color?: string;
  sublabel?: string;
}

function KpiCard({ icon, label, value, color = "text-foreground", sublabel }: KpiCardProps) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className={cn("shrink-0", color)}>{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          {sublabel && <p className="text-[10px] text-muted-foreground/70">{sublabel}</p>}
        </div>
      </div>
    </Card>
  );
}

const QUICK_ACTIONS = [
  { icon: Building2, labelEn: "Create Company", labelAr: "إنشاء شركة", route: "companies" },
  { icon: Users, labelEn: "Create Worker", labelAr: "إنشاء عامل", route: "trainees" },
  { icon: Award, labelEn: "Issue Certificate", labelAr: "إصدار شهادة", route: "certificates" },
  { icon: ClipboardCheck, labelEn: "Compliance Matrix", labelAr: "مصفوفة الامتثال", route: "compliance-matrix" },
  { icon: Search, labelEn: "Search Worker Passport", labelAr: "بحث جواز عامل", route: "worker-passports" },
  { icon: BarChart3, labelEn: "Generate Reports", labelAr: "تقارير", route: "reports" },
];

export function ExecutiveDashboardRoute() {
  const { locale } = useI18n();
  const { navigate } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ companyId: "", courseId: "", dateFrom: "", dateTo: "" });
  // Bumping refreshKey forces the effect to re-run, enabling manual refetch
  // from the "Apply" button without re-introducing setState-in-effect.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Effect: kicks off the fetch whenever filters change OR refresh is clicked.
  // Per the React 19 `react-hooks/set-state-in-effect` rule, setState is NEVER
  // called synchronously in the effect body — all state transitions happen
  // inside the async .then()/.catch()/.finally() callbacks, which the rule
  // allows.
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams();
    if (filters.companyId) params.set("companyId", filters.companyId);
    if (filters.courseId) params.set("courseId", filters.courseId);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);

    // Chain .then() callbacks so no setState runs synchronously in the effect.
    fetch(`/api/compliance/executive-dashboard?${params}`, { credentials: "same-origin" })
      .then((resp) => resp.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setData(json.data);
          setError(null);
        } else {
          setError(json.error || "Failed to load");
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filtersKey, refreshKey]);

  const k = data?.kpis;
  const c = data?.charts;

  const complianceRate = k?.complianceRate ?? 0;
  const complianceColor = complianceRate >= 90 ? "text-green-600" : complianceRate >= 70 ? "text-orange-600" : "text-red-600";

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Executive Compliance Dashboard" : "لوحة الامتثال التنفيذية"}
        subtitle={locale === "en" ? "Real-time compliance overview for GCCLAB administrators" : "نظرة عامة على الامتثال في الوقت الحقيقي للمديرين"}
      />

      {/* Filters bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={locale === "en" ? "Company ID" : "معرف الشركة"}
          value={filters.companyId}
          onChange={(e) => setFilters({ ...filters, companyId: e.target.value })}
          className="h-9 max-w-[160px]"
        />
        <Input
          placeholder={locale === "en" ? "Course ID" : "معرف الدورة"}
          value={filters.courseId}
          onChange={(e) => setFilters({ ...filters, courseId: e.target.value })}
          className="h-9 max-w-[160px]"
        />
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
          className="h-9 max-w-[150px]"
        />
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
          className="h-9 max-w-[150px]"
        />
        <Button size="sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
          {locale === "en" ? "Apply" : "تطبيق"}
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-10 w-10 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 text-center text-destructive">{error}</Card>
      ) : data ? (
        <>
          {/* KPI Cards — Row 1: Companies + Workers */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<Building2 className="h-5 w-5" />} label={locale === "en" ? "Companies" : "الشركات"} value={k!.totalCompanies} color="text-blue-500" />
            <KpiCard icon={<Users className="h-5 w-5" />} label={locale === "en" ? "Workers" : "العمال"} value={k!.totalWorkers} color="text-indigo-500" />
            <KpiCard icon={<UserCheck className="h-5 w-5" />} label={locale === "en" ? "Active Workers" : "عمال نشطون"} value={k!.activeWorkers} color="text-green-500" />
            <KpiCard icon={<Award className="h-5 w-5" />} label={locale === "en" ? "Total Certs" : "إجمالي الشهادات"} value={k!.totalCertificates} color="text-purple-500" />
            <KpiCard icon={<ShieldCheck className="h-5 w-5" />} label={locale === "en" ? "Active Certs" : "شهادات سارية"} value={k!.activeCertificates} color="text-green-600" />
            <KpiCard icon={<AlertTriangle className="h-5 w-5" />} label={locale === "en" ? "Expired" : "منتهية"} value={k!.expiredCertificates} color="text-red-500" />
          </div>

          {/* KPI Cards — Row 2: Expiring windows + Compliance Rate */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={<Clock className="h-4 w-4" />} label={locale === "en" ? "Expiring 7d" : "تنتهي ٧ يوم"} value={k!.expiring7Days} color="text-orange-500" />
            <KpiCard icon={<Clock className="h-4 w-4" />} label={locale === "en" ? "Expiring 30d" : "تنتهي ٣٠ يوم"} value={k!.expiring30Days} color="text-orange-500" />
            <KpiCard icon={<Clock className="h-4 w-4" />} label={locale === "en" ? "Expiring 60d" : "تنتهي ٦٠ يوم"} value={k!.expiring60Days} color="text-amber-500" />
            <KpiCard icon={<Clock className="h-4 w-4" />} label={locale === "en" ? "Expiring 90d" : "تنتهي ٩٠ يوم"} value={k!.expiring90Days} color="text-yellow-600" />
            <KpiCard icon={<TrendingUp className="h-5 w-5" />} label={locale === "en" ? "Compliance Rate" : "نسبة الامتثال"} value={`${k!.complianceRate}%`} color={complianceColor} />
            <KpiCard icon={<FileText className="h-4 w-4" />} label={locale === "en" ? "Pending Approval" : "بانتظار الاعتماد"} value={k!.pendingApprovalCerts} color="text-blue-500" />
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {QUICK_ACTIONS.map((action) => (
              <Button key={action.route} size="sm" variant="outline" onClick={() => navigate(action.route as never)} className="gap-1.5">
                <action.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{locale === "en" ? action.labelEn : action.labelAr}</span>
              </Button>
            ))}
          </div>

          {/* Charts — Row 1: Pie + Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Certificate Status Pie */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Certificate Status" : "حالة الشهادات"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={c!.certStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {c!.certStatus.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* Compliance per Company Bar */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Compliance % per Company" : "نسبة الامتثال لكل شركة"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={c!.complianceByCompany}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="rate" fill="#7B1E2B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Charts — Row 2: Monthly Issued + Renewals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Monthly Certificates Issued" : "الشهادات الشهرية"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={c!.monthlyCertificatesIssued}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="issued" stroke="#7B1E2B" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Monthly Renewals" : "التجديدات الشهرية"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={c!.monthlyRenewals}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="renewals" stroke="#C9A961" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Charts — Row 3: Top Courses + Top Companies */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Top 10 Courses" : "أفضل ١٠ دورات"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={c!.topCourses} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#7B1E2B" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Top 10 Companies" : "أفضل ١٠ شركات"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={c!.topCompanies} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#C9A961" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Chart — Row 4: Workers Missing Mandatory + Lowest Compliance Table */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Workers Missing Mandatory Courses" : "عمال يفتقدون دورات إلزامية"}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={c!.workersMissingMandatory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="course" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="missing" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">{locale === "en" ? "Companies with Lowest Compliance" : "شركات بأدنى امتثال"}</h3>
              <div className="space-y-2 max-h-[250px] overflow-y-auto">
                {data.lowestComplianceCompanies.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{locale === "en" ? "No data" : "لا توجد بيانات"}</p>
                ) : (
                  data.lowestComplianceCompanies.map((c) => (
                    <div key={c.companyId} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.companyName}</p>
                        <p className="text-xs text-muted-foreground">{c.active}✓ · {c.expired}✗ · {c.total} {locale === "en" ? "total" : "إجمالي"}</p>
                      </div>
                      <Badge variant="outline" className={c.complianceRate >= 90 ? "bg-green-50 text-green-700" : c.complianceRate >= 70 ? "bg-orange-50 text-orange-700" : "bg-red-50 text-red-700"}>
                        {c.complianceRate}%
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
