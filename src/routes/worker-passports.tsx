"use client";

import { useState, useCallback, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { cn } from "@/lib/utils";
import {
  BookUser, Search, AlertCircle, Loader2, ArrowLeft, ArrowRight,
  Building2, Fingerprint, FileText, IdCard, GraduationCap, BadgeCheck,
  Clock, ChevronRight, ChevronLeft, X, ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface CompanyOption { id: string; name: string; refNumber: string; }
interface WorkerDoc { url: string; filename: string; type: string; uploadedAt?: string; }
interface WorkerCard {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  status: string;
  companyId: string;
  companyName?: string | null;
  documents: WorkerDoc[];
}
interface HistoryResult {
  source: "certificate" | "exam";
  score: number;
  passed: boolean;
  refNumber?: string;
  issuedAt?: string;
  validUntil?: string;
  attemptedAt?: string;
}
interface HistoryRow {
  id: string;
  courseTitle: string;
  courseCode: string;
  requestRefNumber: string;
  requestCreatedAt?: string | null;
  courseDate?: string | null;
  sessionCount: number;
  requestStatus: string;
  completionStatus: string;
  result: HistoryResult | null;
}
interface PassportDetail {
  trainee: {
    id: string;
    refNumber: string;
    fullName: string;
    nationalId: string;
    nationality?: string | null;
    jobTitle?: string | null;
    mobile?: string | null;
    email?: string | null;
    status: string;
    companyName?: string | null;
    companyRefNumber?: string | null;
    idAttachmentUrl?: string | null;
  };
  identityDocuments: WorkerDoc[];
  summary: { totalCourses: number; completedCourses: number; scheduledCourses: number; certificates: number };
  history: HistoryRow[];
}

const DOC_LABELS: Record<string, { en: string; ar: string }> = {
  iqama: { en: "Iqama", ar: "الإقامة" },
  id: { en: "National ID", ar: "الهوية الوطنية" },
  passport: { en: "Passport", ar: "جواز السفر" },
  certificate: { en: "Certificate", ar: "شهادة" },
  ohs: { en: "OHS Certificate", ar: "شهادة OHS" },
  other: { en: "Other", ar: "أخرى" },
};

const COMPLETION_STYLES: Record<string, { en: string; ar: string; cls: string }> = {
  COMPLETED: { en: "Completed", ar: "مكتملة", cls: "bg-success/10 text-success border-success/20" },
  IN_PROGRESS: { en: "In Progress", ar: "قيد التنفيذ", cls: "bg-info/10 text-info border-info/20" },
  SCHEDULED: { en: "Scheduled", ar: "مجدولة", cls: "bg-info/10 text-info border-info/20" },
  NOT_STARTED: { en: "Not Started", ar: "لم تبدأ", cls: "bg-muted text-muted-foreground border-border" },
};

function WorkerAvatar({
  worker,
  className,
}: {
  worker: { fullName: string; documents?: WorkerDoc[]; idAttachmentUrl?: string | null };
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const identityDoc = (worker.documents ?? []).find((d) => d.type === "id" || d.type === "iqama");
  const candidates = [
    identityDoc ? identityDoc.url : null,
    worker.idAttachmentUrl ?? null,
  ].filter((u): u is string => Boolean(u));
  const src = candidates.find((u) => u !== failed) ?? null;
  const initials = worker.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Avatar className={className ?? "h-14 w-14"}>
      {src && (
        <AvatarImage src={src} alt={worker.fullName} onError={() => setFailed(src)} />
      )}
      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function CompletionBadge({ status, locale }: { status: string; locale: string }) {
  const cfg = COMPLETION_STYLES[status] ?? COMPLETION_STYLES.NOT_STARTED;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", cfg.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {locale === "en" ? cfg.en : cfg.ar}
    </span>
  );
}

function isImageUrl(url: string): boolean {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  return /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/.test(clean) || url.includes("cloudinary.com");
}

function documentLabel(type: string, locale: string): string {
  return DOC_LABELS[type] ? (locale === "en" ? DOC_LABELS[type].en : DOC_LABELS[type].ar) : type;
}

// In-app preview for identity documents. Keeps the worker inside the passport
// page: a working close (X) button returns to the passport instead of leaving
// the app on a raw image tab. Non-image documents get an "open in new tab" link.
function DocumentPreview({ doc, onClose, locale }: { doc: WorkerDoc; onClose: () => void; locale: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = isImageUrl(doc.url) && !imgFailed;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b shrink-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <IdCard className="h-4 w-4 text-primary" />
            {documentLabel(doc.type, locale)}
          </h3>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            title={locale === "en" ? "Close" : "إغلاق"}
            aria-label={locale === "en" ? "Close" : "إغلاق"}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-muted/30 flex items-center justify-center min-h-[200px]">
          {showImage ? (
            <img
              src={doc.url}
              alt={documentLabel(doc.type, locale)}
              onError={() => setImgFailed(true)}
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
          ) : (
            <div className="text-center space-y-3">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                {locale === "en" ? "This document cannot be previewed inline." : "لا يمكن معاينة هذا المستند داخل الصفحة."}
              </p>
              <Button asChild size="sm" variant="outline">
                <a href={doc.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                  <ExternalLink className="h-4 w-4 me-1.5" />
                  {locale === "en" ? "Open in new tab" : "فتح في تبويب جديد"}
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocThumb({ doc, className }: { doc: WorkerDoc; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = isImageUrl(doc.url) && !failed;
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted", className)}>
      {showImage ? (
        <img
          src={doc.url}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}

export function WorkerPassportsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const isContractor = user?.role === "CONTRACTOR";

  const [view, setView] = useState<"companies" | "workers" | "passport">("companies");
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);

  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [selectedWorker, setSelectedWorker] = useState<WorkerCard | null>(null);
  const [passport, setPassport] = useState<PassportDetail | null>(null);
  const [passportLoading, setPassportLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<WorkerDoc | null>(null);

  const canAccess = canAccessModule((user?.permissions ?? []) as never, "worker-passports");

  const loadWorkers = useCallback(async (companyId: string, pageNum: number, searchQuery: string) => {
    setWorkersLoading(true);
    setWorkersError(null);
    try {
      const params: Record<string, string | number> = { page: pageNum, pageSize: 24 };
      if (searchQuery) params.search = searchQuery;
      if (companyId) params.companyId = companyId;
      const res = await api.getList<WorkerCard>("/worker-passports/workers", params);
      setWorkers(res.rows);
      setTotal(res.pagination?.total ?? 0);
      setTotalPages(res.pagination?.totalPages ?? 1);
      setPage(res.pagination?.page ?? pageNum);
    } catch (e) {
      setWorkersError((e as Error).message);
    } finally {
      setWorkersLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCompaniesLoading(true);
      try {
        const res = await api.getList<CompanyOption>("/worker-passports/companies");
        if (cancelled) return;
        setCompanies(res.rows);
        // Contractors skip the company picker — their workers load immediately.
        if (isContractor) {
          const company = res.rows[0];
          if (company) {
            setSelectedCompanyId(company.id);
            setSelectedCompanyName(company.name);
            setView("workers");
            void loadWorkers(company.id, 1, "");
          } else {
            setView("workers");
          }
        }
      } catch (e) {
        if (!cancelled) {
          setCompaniesError((e as Error).message);
          if (isContractor) setView("workers");
        }
      } finally {
        if (!cancelled) setCompaniesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isContractor, loadWorkers]);

  const handleSelectCompany = (company: CompanyOption) => {
    setSelectedCompanyId(company.id);
    setSelectedCompanyName(company.name);
    setSearch("");
    setView("workers");
    void loadWorkers(company.id, 1, "");
  };

  const handleSearch = () => {
    if (selectedCompanyId) void loadWorkers(selectedCompanyId, 1, search);
  };

  const handleOpenPassport = async (worker: WorkerCard) => {
    setSelectedWorker(worker);
    setPassport(null);
    setView("passport");
    setPassportLoading(true);
    try {
      const detail = await api.get<PassportDetail>(`/worker-passports/workers/${worker.id}`);
      setPassport(detail);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setPassportLoading(false);
    }
  };

  const handleBack = () => {
    if (view === "passport") {
      setView("workers");
      setPassport(null);
      setSelectedWorker(null);
    } else if (view === "workers" && !isContractor) {
      setView("companies");
      setSelectedCompanyId(null);
      setSelectedCompanyName(null);
      setWorkers([]);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const renderCompanies = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            {locale === "en" ? "Select a company" : "اختر شركة"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {locale === "en" ? "Companies whose worker passports you can view" : "الشركات التي يمكنك عرض جوازات عمالها"}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {companies.length} {locale === "en" ? "companies" : "شركة"}
        </span>
      </div>

      {companiesError ? (
        <Card className="p-6">
          <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={companiesError} />
        </Card>
      ) : companiesLoading && companies.length === 0 ? (
        <Card className="p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Card>
      ) : companies.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Building2}
            title={locale === "en" ? "No companies available" : "لا توجد شركات متاحة"}
            subtitle={locale === "en" ? "No companies are linked to your account" : "لا توجد شركات مرتبطة بحسابك"}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {companies.map((c) => (
            <Card
              key={c.id}
              className="p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleSelectCompany(c)}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{c.refNumber}</p>
                </div>
                {locale === "en"
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderWorkers = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!isContractor && (
            <Button size="sm" variant="outline" onClick={handleBack} className="gap-1.5">
              {locale === "en" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              {locale === "en" ? "Companies" : "الشركات"}
            </Button>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-2 truncate">
              <BookUser className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{selectedCompanyName ?? (locale === "en" ? "Workers" : "العمال")}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{total} {locale === "en" ? "workers" : "عامل"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === "en" ? "Search by name or National ID..." : "بحث بالاسم أو الهوية..."}
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
      </div>

      {workersError ? (
        <Card className="p-6">
          <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={workersError} />
        </Card>
      ) : workersLoading && workers.length === 0 ? (
        <Card className="p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Card>
      ) : workers.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={BookUser}
            title={locale === "en" ? "No workers found" : "لا يوجد عمال"}
            subtitle={locale === "en" ? "No workers match this company or search" : "لا يوجد عمال لهذه الشركة أو مطابقين للبحث"}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {workers.map((w) => (
            <Card
              key={w.id}
              className="p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => void handleOpenPassport(w)}
            >
              <div className="flex items-center gap-3">
                <WorkerAvatar worker={w} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{w.fullName}</p>
                  <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                    <Fingerprint className="h-3 w-3 shrink-0" />
                    {w.nationalId}
                  </p>
                </div>
                {locale === "en"
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                <span>{w.nationality || "—"}</span>
                {w.jobTitle && <span>{w.jobTitle}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {locale === "en" ? `Page ${page} of ${totalPages} (${total} workers)` : `صفحة ${page} من ${totalPages} (${total} عامل)`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline" disabled={page <= 1 || workersLoading}
              onClick={() => selectedCompanyId && void loadWorkers(selectedCompanyId, page - 1, search)}
            >
              {locale === "en" ? "Previous" : "السابق"}
            </Button>
            <Button
              size="sm" variant="outline" disabled={page >= totalPages || workersLoading}
              onClick={() => selectedCompanyId && void loadWorkers(selectedCompanyId, page + 1, search)}
            >
              {locale === "en" ? "Next" : "التالي"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderResult = (r: HistoryResult | null) => {
    if (!r) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{r.score}%</span>
        {r.source === "certificate" ? (
          <Badge variant="outline" className="bg-success/10 text-success border-success/20">
            {locale === "en" ? "Certified" : "مُصادق عليه"}
          </Badge>
        ) : r.passed ? (
          <Badge variant="outline" className="bg-success/10 text-success border-success/20">
            {locale === "en" ? "Passed" : "ناجح"}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
            {locale === "en" ? "Failed" : "راسب"}
          </Badge>
        )}
        {r.refNumber && <span className="text-[10px] text-muted-foreground font-mono">{r.refNumber}</span>}
      </div>
    );
  };

  const renderPassport = () => (
    <div className="space-y-4">
      <Button size="sm" variant="outline" onClick={handleBack} className="gap-1.5">
        {locale === "en" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        {locale === "en" ? "Back to workers" : "رجوع إلى العمال"}
      </Button>

      {passportLoading ? (
        <Card className="p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Card>
      ) : passport ? (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <WorkerAvatar
                worker={{
                  fullName: passport.trainee.fullName,
                  documents: passport.identityDocuments,
                  idAttachmentUrl: passport.trainee.idAttachmentUrl,
                }}
                className="h-16 w-16 text-base"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{passport.trainee.fullName}</h2>
                  <StatusBadge status={passport.trainee.status} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <Fingerprint className="h-3.5 w-3.5" />{passport.trainee.nationalId}
                  </span>
                  <span>{passport.trainee.nationality || "—"}</span>
                  <span>{passport.trainee.jobTitle || "—"}</span>
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />{passport.trainee.companyName || "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Worker Ref #" : "رقم العامل المرجعي"}</p>
                <p className="font-mono text-xs mt-0.5">{passport.trainee.refNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Company Ref" : "رقم الشركة"}</p>
                <p className="font-mono text-xs mt-0.5">{passport.trainee.companyRefNumber || "—"}</p>
              </div>
              {passport.trainee.mobile && (
                <div>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Mobile" : "الجوال"}</p>
                  <p className="text-xs mt-0.5">{passport.trainee.mobile}</p>
                </div>
              )}
              {passport.trainee.email && (
                <div>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Email" : "البريد"}</p>
                  <p className="text-xs mt-0.5 truncate">{passport.trainee.email}</p>
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xl font-bold">{passport.summary.totalCourses}</p>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Total Courses" : "إجمالي الدورات"}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-xl font-bold text-green-600">{passport.summary.completedCourses}</p>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Completed" : "مكتملة"}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-info" />
                <div>
                  <p className="text-xl font-bold">{passport.summary.scheduledCourses}</p>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Scheduled" : "مجدولة"}</p>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-xl font-bold">{passport.summary.certificates}</p>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Certificates" : "شهادات"}</p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <IdCard className="h-4 w-4 text-primary" />
              {locale === "en" ? "Identity Documents" : "مستندات الهوية"}
            </h3>
            {passport.identityDocuments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {passport.identityDocuments.map((d) => (
                  <button
                    key={`${d.type}-${d.url}`}
                    type="button"
                    onClick={() => setPreviewDoc(d)}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted hover:border-primary/40 transition-colors cursor-pointer"
                    title={locale === "en" ? "Preview document" : "معاينة المستند"}
                  >
                    <DocThumb doc={d} />
                    {documentLabel(d.type, locale)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {locale === "en"
                  ? "No identity documents uploaded yet — they are managed from the trainee's edit screen."
                  : "لا توجد مستندات هوية بعد — تُدار من شاشة تعديل المتدرب."}
              </p>
            )}
          </Card>

          <Card className="p-0">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                {locale === "en" ? "Training History" : "السجل التدريبي"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {passport.history.length} {locale === "en" ? "courses" : "دورة"}
              </span>
            </div>
            {passport.history.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={GraduationCap}
                  title={locale === "en" ? "No training yet" : "لا يوجد تدريب بعد"}
                  subtitle={locale === "en" ? "This worker has not been enrolled in any training request" : "لم يُسجل هذا العامل في أي طلب تدريب"}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{locale === "en" ? "Course" : "الدورة"}</TableHead>
                      <TableHead>{locale === "en" ? "Request" : "الطلب"}</TableHead>
                      <TableHead>{locale === "en" ? "Course Date" : "تاريخ الدورة"}</TableHead>
                      <TableHead>{locale === "en" ? "Request Status" : "حالة الطلب"}</TableHead>
                      <TableHead>{locale === "en" ? "Completion" : "الإكمال"}</TableHead>
                      <TableHead>{locale === "en" ? "Result" : "النتيجة"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {passport.history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium text-sm">{h.courseTitle}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{h.courseCode}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="text-xs font-mono">{h.requestRefNumber}</div>
                            {h.requestCreatedAt && (
                              <div className="text-[10px] text-muted-foreground">{new Date(h.requestCreatedAt).toLocaleDateString()}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {h.courseDate ? (
                            <span className="text-xs">{new Date(h.courseDate).toLocaleDateString()}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={h.requestStatus} /></TableCell>
                        <TableCell><CompletionBadge status={h.completionStatus} locale={locale} /></TableCell>
                        <TableCell>{renderResult(h.result)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card className="p-6 text-center text-muted-foreground">
          {locale === "en" ? "No passport data" : "لا توجد بيانات الجواز"}
        </Card>
      )}

      {previewDoc && (
        <DocumentPreview doc={previewDoc} onClose={() => setPreviewDoc(null)} locale={locale} />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Worker Training Passports" : "جوازات تدريب العمال"}
        subtitle={locale === "en" ? "Worker identity and full training history" : "هوية العامل وسجل تدريبه الكامل"}
        icon={BookUser}
      />
      {view === "companies" && renderCompanies()}
      {view === "workers" && renderWorkers()}
      {view === "passport" && renderPassport()}
    </div>
  );
}
