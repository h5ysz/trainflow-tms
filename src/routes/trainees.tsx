"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Trainees — company-first flow (companies → trainees → trainee record)
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the Worker Passport page structure:
//   1. "companies" — grid of company cards (name + trainee count)
//   2. "trainees"  — grid of the selected company's trainees with search
//      (name / national ID / nationality) + pagination
//   3. "record"    — trainee profile (photo + personal data + identity docs)
//
// RBAC: contractors land directly on their own company's trainees; everyone
// else picks a company first. Create/edit use the same dialog: basic data plus
// the trainee photo and identity attachments, which are saved on the trainee
// file itself (Trainee.documents). Course details / training history are NOT
// shown here — they live in the Worker Passport page.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { cn } from "@/lib/utils";
import { BarcodeImage } from "@/components/common/barcode-image";
import {
  BookUser, Search, AlertCircle, Loader2, ArrowLeft, ArrowRight,
  Building2, Fingerprint, FileText, IdCard,
  ChevronRight, ChevronLeft, X, ExternalLink,
  UserSquare, Plus, Trash2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { canAccessModule } from "@/lib/auth/permissions";

interface CompanyCard {
  id: string;
  name: string;
  refNumber: string;
  traineeCount: number;
}

interface TraineeDoc { url: string; filename: string; type: string; uploadedAt?: string; }

interface TraineeCard {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  status: string;
  companyId: string;
  companyName?: string | null;
  documents?: string | null;
}

interface UploadIdResponse {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

interface RecordDetail {
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
    companyId: string;
    companyName?: string | null;
    companyRefNumber?: string | null;
    documents?: string | null;
  };
  identityDocuments: TraineeDoc[];
}

const STATUSES = ["ACTIVE", "INACTIVE"];

const NEW_TRAINEE = { status: "ACTIVE", nationality: "Saudi" };

const DOC_TYPES = ["id", "iqama", "passport", "certificate", "ohs", "other"] as const;

const PHOTO_TYPE = "photo";

const DOC_LABELS: Record<string, { en: string; ar: string }> = {
  photo: { en: "Photo", ar: "الصورة الشخصية" },
  iqama: { en: "Iqama", ar: "الإقامة" },
  id: { en: "National ID", ar: "الهوية الوطنية" },
  passport: { en: "Passport", ar: "جواز السفر" },
  certificate: { en: "Certificate", ar: "شهادة" },
  ohs: { en: "OHS Certificate", ar: "شهادة OHS" },
  other: { en: "Other", ar: "أخرى" },
};

function TraineeAvatar({ trainee, className }: { trainee: { fullName: string; documents?: TraineeDoc[] }; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const docs = trainee.documents ?? [];
  const photoDoc = docs.find((d) => d.type === PHOTO_TYPE);
  const identityDoc = docs.find((d) => d.type === "id" || d.type === "iqama");
  const candidates = [photoDoc ? photoDoc.url : null, identityDoc ? identityDoc.url : null]
    .filter((u): u is string => Boolean(u));
  const src = candidates.find((u) => u !== failed) ?? null;
  const initials = trainee.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Avatar className={className ?? "h-14 w-14"}>
      {src && (
        <AvatarImage src={src} alt={trainee.fullName} onError={() => setFailed(src)} />
      )}
      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function isImageUrl(url: string): boolean {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  return /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/.test(clean) || url.includes("cloudinary.com");
}

function documentLabel(type: string, locale: string): string {
  return DOC_LABELS[type] ? (locale === "en" ? DOC_LABELS[type].en : DOC_LABELS[type].ar) : type;
}

function DocumentPreview({ doc, onClose, locale }: { doc: TraineeDoc; onClose: () => void; locale: string }) {
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

function DocThumb({ doc, className }: { doc: TraineeDoc; className?: string }) {
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

function parseDocuments(raw: string | null | undefined): TraineeDoc[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => d && typeof d.url === "string" && typeof d.type === "string");
  } catch {
    return [];
  }
}

export function TraineesRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const isContractor = user?.role === "CONTRACTOR";

  const [view, setView] = useState<"companies" | "trainees" | "record">(isContractor ? "trainees" : "companies");
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyCard[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);

  const [trainees, setTrainees] = useState<TraineeCard[]>([]);
  const [traineesLoading, setTraineesLoading] = useState(false);
  const [traineesError, setTraineesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<TraineeDoc | null>(null);

  // Create/edit dialog state — basic data + photo + identity documents.
  // Documents are staged locally (uploaded via /api/trainees/upload-id) and
  // saved with the trainee file on submit — so a replaced ID never comes back.
  const [dialogCompanies, setDialogCompanies] = useState<{ id: string; name: string; refNumber: string }[]>([]);
  const [identityDocs, setIdentityDocs] = useState<TraineeDoc[]>([]);
  const [docType, setDocType] = useState<string>("id");
  const [docUploading, setDocUploading] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docsSeededRef = useRef(false);

  const canAccess = canAccessModule((user?.permissions ?? []) as never, "trainees");

  const loadTrainees = useCallback(async (companyId: string, pageNum: number, searchQuery: string) => {
    setTraineesLoading(true);
    setTraineesError(null);
    try {
      const params: Record<string, string | number> = { page: pageNum, pageSize: 24 };
      if (searchQuery) params.search = searchQuery;
      if (companyId) params.companyId = companyId;
      const res = await api.getList<TraineeCard>("/trainees", params);
      setTrainees(res.rows);
      setTotal(res.pagination?.total ?? 0);
      setTotalPages(res.pagination?.totalPages ?? 1);
      setPage(res.pagination?.page ?? pageNum);
    } catch (e) {
      setTraineesError((e as Error).message);
    } finally {
      setTraineesLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCompaniesLoading(true);
      try {
        const res = await api.getList<CompanyCard>("/trainees/companies");
        if (cancelled) return;
        setCompanies(res.rows);
        // Contractors skip the company picker — their trainees load immediately.
        if (isContractor) {
          const company = res.rows[0];
          if (company) {
            setSelectedCompanyId(company.id);
            setSelectedCompanyName(company.name);
            setView("trainees");
            void loadTrainees(company.id, 1, "");
          } else {
            setView("trainees");
          }
        }
      } catch (e) {
        if (!cancelled) {
          setCompaniesError((e as Error).message);
          if (isContractor) setView("trainees");
        }
      } finally {
        if (!cancelled) setCompaniesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isContractor, loadTrainees]);

  const refetch = useCallback(() => {
    if (selectedCompanyId) void loadTrainees(selectedCompanyId, page, search);
  }, [selectedCompanyId, page, search, loadTrainees]);

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, editingId, formData, setField, setFormData, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<TraineeCard>({
    resource: "/trainees",
    module: "trainees",
    refetch,
    fetchOnEdit: true,
    // Normalize the stored documents JSON string into an array so the edit
    // dialog (and submit) always deal with a plain array.
    toForm: (row) => {
      const { documents, ...rest } = row;
      return { ...rest, documents: Array.isArray(documents) ? documents : parseDocuments(typeof documents === "string" ? documents : null) };
    },
    mapError: (msg) => (msg.includes("already exists") ? t("trainees.duplicate") : msg),
  });

  useEffect(() => {
    if (dialogOpen && dialogCompanies.length === 0 && user?.role !== "CONTRACTOR") {
      api.getList<{ id: string; name: string; refNumber: string }>("/companies", { pageSize: 100 }).then((r) => {
        setDialogCompanies(r.rows.map((c) => ({ id: c.id, name: c.name, refNumber: c.refNumber })));
      }).catch(() => {});
    }
  }, [dialogOpen, dialogCompanies.length, user?.role]);

  // Seed the staged documents list once when the dialog opens. `toForm` already
  // normalizes the fetched record's documents into an array; afterwards local
  // changes (upload/delete/replace) are authoritative and never clobbered —
  // so a replaced/removed ID can never come back on save.
  useEffect(() => {
    if (dialogOpen) docsSeededRef.current = false;
  }, [dialogOpen]);

  const syncDocs = useCallback((next: TraineeDoc[]) => {
    setIdentityDocs(next);
    setFormData((f) => ({ ...f, documents: next }));
  }, [setFormData]);

  useEffect(() => {
    if (!dialogOpen || docsSeededRef.current) return;
    if (isEditing && editingId) {
      const docs = formData.documents;
      syncDocs(Array.isArray(docs) ? (docs as TraineeDoc[]) : parseDocuments(typeof docs === "string" ? docs : null));
      docsSeededRef.current = true;
    } else {
      syncDocs([]);
      docsSeededRef.current = true;
    }
  }, [dialogOpen, isEditing, editingId, formData.documents, syncDocs]);

  const handleUploadDoc = async (file: File, type: string) => {
    setDocUploading(true);
    try {
      const res = await api.postFile<UploadIdResponse>("/trainees/upload-id", file);
      const doc: TraineeDoc = { url: res.url, filename: res.filename, type, uploadedAt: new Date().toISOString() };
      const next = [...(type === "other" ? identityDocs : identityDocs.filter((d) => d.type !== type)), doc];
      syncDocs(next);
      toast({ title: t("misc.success"), description: locale === "en" ? "Document staged" : "تم تجهيز المستند" });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDocUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = (doc: TraineeDoc) => {
    setDeletingDoc(doc.url);
    syncDocs(identityDocs.filter((d) => !(d.type === doc.type && d.url === doc.url)));
    setDeletingDoc(null);
  };

  const handleSelectCompany = (company: CompanyCard) => {
    setSelectedCompanyId(company.id);
    setSelectedCompanyName(company.name);
    setSearch("");
    setPage(1);
    setView("trainees");
    void loadTrainees(company.id, 1, "");
  };

  const handleSearch = () => {
    if (selectedCompanyId) void loadTrainees(selectedCompanyId, 1, search);
  };

  const handleOpenRecord = async (trainee: TraineeCard) => {
    setRecord(null);
    setView("record");
    setRecordLoading(true);
    try {
      const full = await api.get<{
        id: string;
        refNumber: string;
        fullName: string;
        nationalId: string;
        nationality?: string | null;
        jobTitle?: string | null;
        mobile?: string | null;
        email?: string | null;
        status: string;
        companyId: string;
        documents?: string | null;
        company?: { name: string; refNumber: string } | null;
      }>(`/trainees/${trainee.id}`);
      setRecord({
        trainee: {
          id: full.id,
          refNumber: full.refNumber,
          fullName: full.fullName,
          nationalId: full.nationalId,
          nationality: full.nationality,
          jobTitle: full.jobTitle,
          mobile: full.mobile,
          email: full.email,
          status: full.status,
          companyId: full.companyId,
          companyName: full.company?.name ?? null,
          companyRefNumber: full.company?.refNumber ?? null,
          documents: full.documents,
        },
        identityDocuments: parseDocuments(full.documents),
      });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
      setView("trainees");
    } finally {
      setRecordLoading(false);
    }
  };

  const handleBack = () => {
    if (view === "record") {
      setView("trainees");
      setRecord(null);
    } else if (view === "trainees" && !isContractor) {
      setView("companies");
      setSelectedCompanyId(null);
      setSelectedCompanyName(null);
      setTrainees([]);
    }
  };

  const handleOpenCreate = () => {
    openCreate({ ...NEW_TRAINEE, ...(user?.role !== "CONTRACTOR" && selectedCompanyId ? { companyId: selectedCompanyId } : {}) });
  };

  const handleSubmit = () =>
    void submit(() => {
      const missing = requireFields({
        [t("trainees.fullName")]: "fullName",
        [t("trainees.nationalId")]: "nationalId",
      })();
      if (missing) return missing;
      // Contractors don't pick a company — the backend sets it from their account.
      if (user?.role !== "CONTRACTOR" && !formData.companyId) {
        return `${t("trainees.company")} — ${t("misc.required")}`;
      }
      return null;
    });

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
            {locale === "en" ? "Companies whose trainees you can view" : "الشركات التي يمكنك عرض متدربيها"}
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
              </div>
              <div className="mt-3 flex items-center justify-between border-t pt-2">
                <span className="text-xs text-muted-foreground">
                  {c.traineeCount} {locale === "en" ? "trainees" : "متدرب"}
                </span>
                {locale === "en"
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  : <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderTrainees = () => (
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
              <span className="truncate">{selectedCompanyName ?? (locale === "en" ? "Trainees" : "المتدربون")}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{total} {locale === "en" ? "trainees" : "متدرب"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === "en" ? "Search by name, ID or nationality..." : "بحث بالاسم أو الهوية أو الجنسية..."}
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
          {canCreate && (
            <Button onClick={handleOpenCreate} size="sm">
              <Plus className="h-4 w-4 me-1.5" />
              {t("trainees.new")}
            </Button>
          )}
        </div>
      </div>

      {traineesError ? (
        <Card className="p-6">
          <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={traineesError} />
        </Card>
      ) : traineesLoading && trainees.length === 0 ? (
        <Card className="p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Card>
      ) : trainees.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={BookUser}
            title={locale === "en" ? "No trainees found" : "لا يوجد متدربون"}
            subtitle={locale === "en" ? "No trainees match this company or search" : "لا يوجد متدربون لهذه الشركة أو مطابقين للبحث"}
            action={canCreate && (
              <Button onClick={handleOpenCreate}>
                <Plus className="h-4 w-4 me-1.5" />
                {t("trainees.new")}
              </Button>
            )}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {trainees.map((tr) => (
            <Card
              key={tr.id}
              className="p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => void handleOpenRecord(tr)}
            >
              <div className="flex items-center gap-3">
                <TraineeAvatar trainee={{ fullName: tr.fullName, documents: parseDocuments(tr.documents) }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{tr.fullName}</p>
                  <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                    <Fingerprint className="h-3 w-3 shrink-0" />
                    {tr.nationalId}
                  </p>
                </div>
                {locale === "en"
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{tr.nationality || "—"}</span>
                  {tr.jobTitle && <span>{tr.jobTitle}</span>}
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[9rem]">{tr.companyName || "—"}</span>
                  </span>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={() => void openEdit(tr)}
                    onDelete={() => setDeleteTarget(tr)}
                  />
                </div>
              </div>
              <div className="mt-2 pt-2 border-t flex justify-center" onClick={(e) => e.stopPropagation()}>
                <BarcodeImage value={tr.nationalId} height={32} fontSize={8} className="text-muted-foreground w-full max-w-[180px]" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {locale === "en" ? `Page ${page} of ${totalPages} (${total} trainees)` : `صفحة ${page} من ${totalPages} (${total} متدرب)`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline" disabled={page <= 1 || traineesLoading}
              onClick={() => selectedCompanyId && void loadTrainees(selectedCompanyId, page - 1, search)}
            >
              {locale === "en" ? "Previous" : "السابق"}
            </Button>
            <Button
              size="sm" variant="outline" disabled={page >= totalPages || traineesLoading}
              onClick={() => selectedCompanyId && void loadTrainees(selectedCompanyId, page + 1, search)}
            >
              {locale === "en" ? "Next" : "التالي"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderRecord = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={handleBack} className="gap-1.5">
          {locale === "en" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          {locale === "en" ? "Back to trainees" : "رجوع إلى المتدربين"}
        </Button>
        {record && canEdit && (
          <Button size="sm" variant="outline" onClick={() => record && void openEdit({ ...record.trainee, companyName: record.trainee.companyName, companyRef: record.trainee.companyRefNumber } as TraineeCard)}>
            <IdCard className="h-4 w-4 me-1.5" />
            {t("trainees.edit")}
          </Button>
        )}
      </div>

      {recordLoading ? (
        <Card className="p-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Card>
      ) : record ? (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start gap-4">
              <TraineeAvatar
                trainee={{ fullName: record.trainee.fullName, documents: record.identityDocuments }}
                className="h-16 w-16 text-base"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{record.trainee.fullName}</h2>
                  <StatusBadge status={record.trainee.status} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <Fingerprint className="h-3.5 w-3.5" />{record.trainee.nationalId}
                  </span>
                  <span>{record.trainee.nationality || "—"}</span>
                  <span>{record.trainee.jobTitle || "—"}</span>
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />{record.trainee.companyName || "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Trainee Ref #" : "رقم المتدرب المرجعي"}</p>
                <p className="font-mono text-xs mt-0.5">{record.trainee.refNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{locale === "en" ? "Company Ref" : "رقم الشركة"}</p>
                <p className="font-mono text-xs mt-0.5">{record.trainee.companyRefNumber || "—"}</p>
              </div>
              {record.trainee.mobile && (
                <div>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Mobile" : "الجوال"}</p>
                  <p className="text-xs mt-0.5">{record.trainee.mobile}</p>
                </div>
              )}
              {record.trainee.email && (
                <div>
                  <p className="text-xs text-muted-foreground">{locale === "en" ? "Email" : "البريد"}</p>
                  <p className="text-xs mt-0.5 truncate">{record.trainee.email}</p>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <IdCard className="h-4 w-4 text-primary" />
              {locale === "en" ? "Identity Documents" : "مستندات الهوية"}
            </h3>
            {record.identityDocuments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {record.identityDocuments.map((d) => (
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
                  ? "No documents uploaded yet — add the trainee photo and identity from the edit screen."
                  : "لا توجد مستندات بعد — أضف صورة المتدرب والهوية من شاشة التعديل."}
              </p>
            )}
          </Card>
        </>
      ) : (
        <Card className="p-6 text-center text-muted-foreground">
          {locale === "en" ? "No trainee data" : "لا توجد بيانات المتدرب"}
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
        title={t("trainees.title")}
        subtitle={t("trainees.subtitle")}
        icon={UserSquare}
      />
      {view === "companies" && renderCompanies()}
      {view === "trainees" && renderTrainees()}
      {view === "record" && renderRecord()}

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("trainees.edit") : t("trainees.new")}
        description={t("trainees.subtitle")}
        icon={UserSquare}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("trainees.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("trainees.nationalId")} required>
              <Input placeholder="0000000000" value={(formData.nationalId as string) ?? ""} onChange={(e) => setField("nationalId", e.target.value)} />
            </Field>
            <Field label={t("trainees.nationality")}>
              <Input placeholder="Saudi" value={(formData.nationality as string) ?? ""} onChange={(e) => setField("nationality", e.target.value)} />
            </Field>
            <Field label={t("trainees.jobTitle")}>
              <Input placeholder="HSE Officer" value={(formData.jobTitle as string) ?? ""} onChange={(e) => setField("jobTitle", e.target.value)} />
            </Field>
            <Field label={t("trainees.mobile")}>
              <Input placeholder="+966 5X XXX XXXX" value={(formData.mobile as string) ?? ""} onChange={(e) => setField("mobile", e.target.value)} />
            </Field>
            <Field label={t("trainees.email")}>
              <Input type="email" placeholder="trainee@company.com" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
            </Field>
          </FormGrid>

          {user?.role !== "CONTRACTOR" && (
            <Field label={t("trainees.company")} required>
              <Select value={(formData.companyId as string) ?? ""} onValueChange={(v) => setField("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {dialogCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label={t("trainees.status")}>
            <Select value={(formData.status as string) ?? "ACTIVE"} onValueChange={(v) => setField("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("trainees.notes")}>
            <Textarea rows={2} placeholder={t("trainees.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>

          <div className="rounded-lg border p-4 space-y-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <UserSquare className="h-4 w-4 text-primary" />
              {locale === "en" ? "Trainee Photo" : "صورة المتدرب"}
            </h4>
            <div className="flex flex-wrap items-center gap-4">
              <TraineeAvatar
                trainee={{ fullName: (formData.fullName as string) ?? "", documents: identityDocs }}
                className="h-16 w-16 text-base"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="h-9 w-56 text-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUploadDoc(file, PHOTO_TYPE);
                  }}
                />
                {docUploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {identityDocs.some((d) => d.type === PHOTO_TYPE) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      const photo = identityDocs.find((d) => d.type === PHOTO_TYPE);
                      if (photo) handleDeleteDoc(photo);
                    }}
                  >
                    <Trash2 className="h-4 w-4 me-1.5" />
                    {locale === "en" ? "Remove photo" : "حذف الصورة"}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {locale === "en"
                ? "JPG, PNG or WebP up to 5 MB. Replacing the photo removes the previous one."
                : "JPG أو PNG أو WebP حتى 5 ميجابايت. استبدال الصورة يحذف الصورة السابقة."}
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <IdCard className="h-4 w-4 text-primary" />
              {locale === "en" ? "Identity Documents" : "مستندات الهوية"}
            </h4>

            {identityDocs.some((d) => d.type !== PHOTO_TYPE) && (
              <div className="flex flex-wrap gap-2">
                {identityDocs.filter((d) => d.type !== PHOTO_TYPE).map((d) => (
                  <div key={`${d.type}-${d.url}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground">
                      {documentLabel(d.type, locale)}
                    </span>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center" title={locale === "en" ? "Open document" : "فتح المستند"}>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-destructive hover:text-destructive"
                      disabled={deletingDoc === d.url}
                      onClick={() => void handleDeleteDoc(d)}
                      title={locale === "en" ? "Remove document" : "حذف المستند"}
                    >
                      {deletingDoc === d.url ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select value={docType} onValueChange={(v) => setDocType(v)}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {documentLabel(dt, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="h-9 w-56 text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadDoc(file, docType);
                }}
              />
              {docUploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {locale === "en"
                ? "JPG, PNG, WebP or PDF up to 5 MB. Non-\"other\" types replace the previous document of the same type."
                : "JPG أو PNG أو WebP أو PDF حتى 5 ميجابايت. الأنواع غير \"أخرى\" تستبدل المستند السابق من نفس النوع."}
            </p>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.fullName}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
