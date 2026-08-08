"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { UserSquare, Plus, Mail, Phone, Building2, AlertCircle, Fingerprint, IdCard, ExternalLink, Trash2, Loader2 } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface CompanyOption { id: string; name: string; refNumber: string; }
interface Trainee {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
  companyId: string;
  companyName?: string | null;
  companyRef?: string | null;
  status: string;
  requestsCount: number;
  createdAt: string;
}

const STATUSES = ["ACTIVE", "INACTIVE"];

const NEW_TRAINEE = { status: "ACTIVE", nationality: "Saudi" };

interface TraineeDocument { url: string; filename: string; type: string; uploadedAt?: string; }

const DOC_TYPES = ["id", "iqama", "passport", "certificate", "ohs", "other"] as const;

const DOC_LABELS: Record<string, { en: string; ar: string }> = {
  iqama: { en: "Iqama", ar: "الإقامة" },
  id: { en: "National ID", ar: "الهوية الوطنية" },
  passport: { en: "Passport", ar: "جواز السفر" },
  certificate: { en: "Certificate", ar: "شهادة" },
  ohs: { en: "OHS Certificate", ar: "شهادة OHS" },
  other: { en: "Other", ar: "أخرى" },
};

export function TraineesRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  // Identity documents (managed from the edit dialog)
  const [identityDocs, setIdentityDocs] = useState<TraineeDocument[]>([]);
  const [docType, setDocType] = useState<string>("id");
  const [docUploading, setDocUploading] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Trainee>("/trainees");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, editingId, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Trainee>({
    resource: "/trainees",
    module: "trainees",
    refetch,
    fetchOnEdit: true,
    mapError: (msg) => (msg.includes("already exists") ? t("trainees.duplicate") : msg),
  });

  useEffect(() => {
    if (dialogOpen && companies.length === 0 && user?.role !== "CONTRACTOR") {
      api.getList<CompanyOption>("/companies", { pageSize: 100 }).then((r) => {
        setCompanies(r.rows.map((c) => ({ id: c.id, name: c.name, refNumber: c.refNumber })));
      }).catch(() => {});
    }
  }, [dialogOpen, companies.length, user?.role]);

  // Seed the identity-documents list from the fetched trainee when editing.
  useEffect(() => {
    if (!dialogOpen || !isEditing || !editingId) {
      setIdentityDocs([]);
      return;
    }
    const raw = formData.documents as string | null | undefined;
    if (typeof raw === "string") {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setIdentityDocs(arr);
        else setIdentityDocs([]);
      } catch {
        setIdentityDocs([]);
      }
    } else {
      setIdentityDocs([]);
    }
  }, [dialogOpen, isEditing, editingId, formData.documents]);

  const handleUploadDoc = async (file: File) => {
    if (!editingId) return;
    setDocUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("type", docType);
      const resp = await fetch(`/api/trainees/${editingId}/documents`, { method: "POST", body, credentials: "same-origin" });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || "Upload failed");
      setIdentityDocs((prev) => [
        ...(docType === "other" ? prev : prev.filter((d) => d.type !== docType)),
        json.data,
      ]);
      toast({ title: t("misc.success"), description: locale === "en" ? "Document uploaded" : "تم رفع المستند" });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDocUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (doc: TraineeDocument) => {
    if (!editingId) return;
    setDeletingDoc(doc.url);
    try {
      const query = `type=${encodeURIComponent(doc.type)}&url=${encodeURIComponent(doc.url)}`;
      const resp = await fetch(`/api/trainees/${editingId}/documents?${query}`, { method: "DELETE", credentials: "same-origin" });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || "Delete failed");
      setIdentityDocs((prev) => prev.filter((d) => !(d.type === doc.type && d.url === doc.url)));
      toast({ title: t("misc.success"), description: locale === "en" ? "Document removed" : "تم حذف المستند" });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeletingDoc(null);
    }
  };

  const columns: Column<Trainee>[] = [
    {
      key: "name",
      header: t("trainees.fullName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{r.fullName}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{r.refNumber}</div>
          </div>
        </div>
      ),
    },
    {
      key: "nationalId",
      header: t("trainees.nationalId"),
      cell: (r) => (
        <div className="text-xs flex items-center gap-1.5 font-mono">
          <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
          {r.nationalId}
        </div>
      ),
    },
    {
      key: "nationality",
      header: t("trainees.nationality"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.nationality || "—"}</span>,
    },
    {
      key: "jobTitle",
      header: t("trainees.jobTitle"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.jobTitle || "—"}</span>,
    },
    {
      key: "contact",
      header: t("trainees.mobile"),
      cell: (r) => (
        <div className="space-y-0.5">
          {r.mobile && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.mobile}</div>}
          {r.email && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{r.email}</div>}
        </div>
      ),
    },
    {
      key: "company",
      header: t("trainees.company"),
      cell: (r) => (
        <div className="text-sm">
          <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName || "—"}</div>
          {r.companyRef && <div className="text-[10px] text-muted-foreground font-mono">{r.companyRef}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: t("trainees.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <RowActions
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => void openEdit(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
    },
  ];

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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("trainees.title")}
        subtitle={t("trainees.subtitle")}
        icon={UserSquare}
        actions={canCreate && <Button onClick={() => openCreate(NEW_TRAINEE)}><Plus className="h-4 w-4 me-1.5" />{t("trainees.new")}</Button>}
      />
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        page={page}
        total={pagination?.total ?? 0}
        pageSize={pagination?.pageSize ?? 10}
        onPageChange={setPage}
        emptyIcon={UserSquare}
        emptyTitle={t("trainees.empty.title")}
        emptySubtitle={t("trainees.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate(NEW_TRAINEE)}><Plus className="h-4 w-4 me-1.5" />{t("trainees.new")}</Button>}
      />

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
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
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

          {isEditing && (
            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <IdCard className="h-4 w-4 text-primary" />
                {locale === "en" ? "Identity Documents" : "مستندات الهوية"}
              </h4>

              {identityDocs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {identityDocs.map((d) => (
                    <div key={`${d.type}-${d.url}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        {DOC_LABELS[d.type] ? (locale === "en" ? DOC_LABELS[d.type].en : DOC_LABELS[d.type].ar) : d.type}
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
                        {DOC_LABELS[dt] ? (locale === "en" ? DOC_LABELS[dt].en : DOC_LABELS[dt].ar) : dt}
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
                    if (file) void handleUploadDoc(file);
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
          )}
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
