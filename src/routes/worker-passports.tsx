"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  BookUser, Search, AlertCircle, Loader2, FileText, QrCode, TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface WorkerPassportRow {
  id: string;
  passportNumber: string;
  nationalId: string;
  fullName: string;
  companyName: string | null;
  jobTitle: string | null;
  qrToken: string;
  compliancePercent: number;
  complianceLevel: "GREEN" | "ORANGE" | "RED";
  totalActive: number;
  totalExpired: number;
  totalExpiringSoon: number;
  totalMissing: number;
}

interface PassportListResponse {
  passports: WorkerPassportRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const LEVEL_STYLES: Record<string, string> = {
  GREEN: "bg-green-100 text-green-800 border-green-200",
  ORANGE: "bg-orange-100 text-orange-800 border-orange-200",
  RED: "bg-red-100 text-red-800 border-red-200",
};

export function WorkerPassportsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [search, setSearch] = useState("");
  const [data, setData] = useState<WorkerPassportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedPassport, setSelectedPassport] = useState<WorkerPassportRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);

  const canAccess = canAccessModule((user?.permissions ?? []) as never, "worker-passports");

  const fetchData = useCallback(async (pageNum: number = 1, searchQuery: string = "") => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pageNum), pageSize: "20" });
      if (searchQuery) params.set("search", searchQuery);
      const res = await api.getList<WorkerPassportRow>(`/worker-passports?${params}`);
      // api.getList returns { rows, pagination } — but our API returns { passports, pagination }
      // Use a direct fetch fallback
      const resp = await fetch(`/api/worker-passports?${params}`, { credentials: "same-origin" });
      const json = await resp.json();
      if (json.success) {
        const d = json.data as PassportListResponse;
        setData(d.passports);
        setTotal(d.pagination.total);
        setTotalPages(d.pagination.totalPages);
        setPage(d.pagination.page);
      } else {
        setError(json.error || "Failed to load");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  if (data.length === 0 && !loading && !error) {
    fetchData(1);
  }

  const handleSearch = () => fetchData(1, search);

  const handleViewDetail = async (row: WorkerPassportRow) => {
    setSelectedPassport(row);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const resp = await fetch(`/api/worker-passports/${row.id}`, { credentials: "same-origin" });
      const json = await resp.json();
      if (json.success) {
        setDetailData(json.data);
      } else {
        toast({ title: t("misc.error"), description: json.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const columns: Column<WorkerPassportRow>[] = [
    {
      key: "fullName",
      header: locale === "en" ? "Worker" : "العامل",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.fullName}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.nationalId}</div>
        </div>
      ),
    },
    {
      key: "passportNumber",
      header: locale === "en" ? "Passport #" : "رقم الجواز",
      cell: (row) => <span className="font-mono text-xs">{row.passportNumber}</span>,
    },
    {
      key: "companyName",
      header: locale === "en" ? "Company" : "الشركة",
      cell: (row) => <span className="text-sm">{row.companyName || "—"}</span>,
    },
    {
      key: "compliancePercent",
      header: locale === "en" ? "Compliance" : "الامتثال",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={LEVEL_STYLES[row.complianceLevel] ?? ""}>
            {row.compliancePercent}%
          </Badge>
          <span className="text-xs text-muted-foreground">
            {row.totalActive}✓ {row.totalExpired}✗ {row.totalExpiringSoon}⚠
          </span>
        </div>
      ),
    },
    {
      key: "actions",
      header: locale === "en" ? "Actions" : "إجراءات",
      cell: (row) => (
        <Button size="sm" variant="ghost" onClick={() => handleViewDetail(row)} className="gap-1.5 h-8">
          <FileText className="h-3.5 w-3.5" />
          {locale === "en" ? "Details" : "تفاصيل"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Worker Training Passports" : "جوازات تدريب العمال"}
        subtitle={locale === "en" ? "View worker compliance, certificates, and training history" : "عرض امتثال العمال والشهادات وتاريخ التدريب"}
      />

      {/* Search bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={locale === "en" ? "Search by National ID, name, passport #, or QR..." : "بحث بالهوية أو الاسم أو رقم الجواز..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="ps-9 h-10"
          />
        </div>
        <Button onClick={handleSearch} variant="default" size="sm">
          <Search className="h-4 w-4 me-1.5" />
          {locale === "en" ? "Search" : "بحث"}
        </Button>
      </div>

      {/* Stats summary */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <BookUser className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{total}</p>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Total Workers" : "إجمالي العمال"}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-xl font-bold text-green-600">{data.filter(d => d.complianceLevel === "GREEN").length}</p>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Compliant" : "ممتثل"}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <div>
                <p className="text-xl font-bold text-orange-600">{data.filter(d => d.complianceLevel === "ORANGE").length}</p>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Partial" : "جزئي"}</p>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-xl font-bold text-red-600">{data.filter(d => d.complianceLevel === "RED").length}</p>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Non-Compliant" : "غير ممتثل"}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card className="p-0">
        {error ? (
          <div className="p-6">
            <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={error} />
          </div>
        ) : loading && data.length === 0 ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DataTable
            data={data}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyIcon={BookUser}
            emptyTitle={locale === "en" ? "No worker passports found" : "لا توجد جوازات عمال"}
            emptySubtitle={locale === "en" ? "Passports are auto-generated when certificates are issued" : "تُنشأ الجوازات تلقائياً عند إصدار الشهادات"}
          />
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {locale === "en" ? `Page ${page} of ${totalPages} (${total} workers)` : `صفحة ${page} من ${totalPages} (${total} عامل)`}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => fetchData(page - 1, search)}>
              {locale === "en" ? "Previous" : "السابق"}
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => fetchData(page + 1, search)}>
              {locale === "en" ? "Next" : "التالي"}
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      {selectedPassport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedPassport(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">{selectedPassport.fullName}</h2>
                <p className="text-xs text-muted-foreground font-mono">{selectedPassport.passportNumber}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedPassport(null)}>✕</Button>
            </div>

            {detailLoading ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : detailData ? (
              <div className="p-4 space-y-4">
                {/* Compliance score */}
                <div className={`rounded-lg p-4 border-2 ${
                  (detailData.compliance as { level: string })?.level === "GREEN" ? "bg-green-50 border-green-200" :
                  (detailData.compliance as { level: string })?.level === "ORANGE" ? "bg-orange-50 border-orange-200" :
                  "bg-red-50 border-red-200"
                }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">{locale === "en" ? "Compliance Score" : "درجة الامتثال"}</p>
                      <p className="text-3xl font-bold">{(detailData.compliance as { percent: number })?.percent}%</p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{(detailData.compliance as { totalCompleted: number })?.totalCompleted} / {(detailData.compliance as { totalRequired: number })?.totalRequired} {locale === "en" ? "courses" : "دورات"}</p>
                      <p className="text-xs text-gray-500">
                        ✓ {(detailData.compliance as { totalCompleted: number })?.totalCompleted} ·
                        ✗ {(detailData.compliance as { totalExpired: number })?.totalExpired} ·
                        ⚠ {(detailData.compliance as { totalExpiringSoon: number })?.totalExpiringSoon} ·
                        ○ {(detailData.compliance as { totalMissing: number })?.totalMissing}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Worker info */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">{locale === "en" ? "National ID:" : "الهوية:"}</span> {selectedPassport.nationalId}</div>
                  <div><span className="text-muted-foreground">{locale === "en" ? "Company:" : "الشركة:"}</span> {selectedPassport.companyName || "—"}</div>
                  <div><span className="text-muted-foreground">{locale === "en" ? "Job Title:" : "المسمى:"}</span> {selectedPassport.jobTitle || "—"}</div>
                  <div><span className="text-muted-foreground">QR:</span> <span className="font-mono text-xs">{selectedPassport.qrToken.substring(0, 12)}...</span></div>
                </div>

                {/* Required courses */}
                {((detailData.remainingRequiredCourses as unknown[]) ?? []).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">{locale === "en" ? "Remaining Required Courses" : "الدورات المطلوبة المتبقية"}</h3>
                    <div className="space-y-1">
                      {(detailData.remainingRequiredCourses as Array<{ courseCode: string; courseTitle: string; status: string; isCoreMandatory: boolean }>).map((req, i) => (
                        <div key={i} className="flex items-center justify-between text-sm border-b pb-1">
                          <div className="flex items-center gap-2">
                            <span className={req.status === "MISSING" ? "text-gray-400" : req.status === "EXPIRED" ? "text-red-500" : "text-orange-500"}>
                              {req.status === "MISSING" ? "○" : req.status === "EXPIRED" ? "✗" : "⚠"}
                            </span>
                            <span>{req.courseTitle}</span>
                            {req.isCoreMandatory && <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600">CORE</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground">{req.status.replace("_", " ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Certificate history */}
                {((detailData.certificateHistory as unknown[]) ?? []).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">{locale === "en" ? "Certificate History" : "تاريخ الشهادات"}</h3>
                    <div className="space-y-2">
                      {(detailData.certificateHistory as Array<{ refNumber: string; courseCode: string; courseTitle: string; issuedAt: string; validUntil: string; status: string }>).map((cert, i) => (
                        <div key={i} className="border-b pb-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{cert.courseTitle}</span>
                            <Badge variant="outline" className={`text-xs ${cert.status === "EXPIRED" || new Date(cert.validUntil) < new Date() ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                              {new Date(cert.validUntil) < new Date() ? "Expired" : "Valid"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="font-mono">{cert.refNumber}</span>
                            <span>{locale === "en" ? "Issued:" : "إصدار:"} {new Date(cert.issuedAt).toLocaleDateString()}</span>
                            <span>{locale === "en" ? "Expiry:" : "انتهاء:"} {new Date(cert.validUntil).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* QR link */}
                <div className="pt-2 border-t">
                  <a
                    href={`/worker/${selectedPassport.qrToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1.5"
                  >
                    <QrCode className="h-4 w-4" />
                    {locale === "en" ? "Open Public Passport Page" : "فتح صفحة الجواز العامة"}
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">No data</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
