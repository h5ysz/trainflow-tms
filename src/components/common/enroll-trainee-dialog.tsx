"use client";

// GCCLAB TMS — EnrollTraineeDialog
// =====================================================================
// Replaces the old single-select "Enroll Trainee" dialog in the session
// detail page with a company-first flow:
//
//   Mode 1 — Existing Trainee
//     Pick a company → the trainees registered under that company load →
//     select one → enroll.
//
//   Mode 2 — New Trainee
//     Trainee not in the system yet? Choose "New Trainee", fill the same
//     manual entry fields used everywhere else (name, national ID/Iqama,
//     nationality, job title, mobile, email), pick the company, upload the
//     ID/Iqama document (staged through /api/trainees/upload-id), add any
//     extra documents, then the trainee is created and immediately enrolled
//     in the session.
//
// Reuses the exact validation + document model of the rest of the system:
//   - POST /api/trainees/upload-id  → staged upload {url, filename, ...}
//   - POST /api/trainees            → create (server-side duplicate check)
//   - POST /api/sessions/[id]/enrollments → enroll {traineeId}

import * as React from "react";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Users, UserPlus, Building2, Upload, Loader2, X, FileCheck, FileImage, FileText, Paperclip,
} from "lucide-react";

interface UploadIdResponse {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

interface TraineeDocument {
  url: string;
  filename: string;
  type: "iqama" | "id" | "passport" | "certificate" | "ohs" | "other";
  uploadedAt: string;
}

interface CompanyOption {
  id: string;
  name: string;
  refNumber: string;
  region: string | null;
  traineeCount: number;
}

interface TraineeOption {
  id: string;
  fullName: string;
  refNumber: string;
  nationalId: string;
}

const DOC_TYPES: TraineeDocument["type"][] = ["iqama", "id", "passport", "certificate", "ohs", "other"];

export interface EnrollTraineeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  /** Called after a successful enrollment so the parent can reload. */
  onEnrolled?: () => void;
  /** Trainee IDs already enrolled in the session — hidden from the picker. */
  enrolledTraineeIds?: string[];
}

export function EnrollTraineeDialog({
  open, onOpenChange, sessionId, onEnrolled, enrolledTraineeIds = [],
}: EnrollTraineeDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [mode, setMode] = React.useState<"existing" | "new">("existing");

  // ── Shared: companies ──
  const [companies, setCompanies] = React.useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = React.useState(false);

  // ── Existing trainee mode ──
  const [companyId, setCompanyId] = React.useState("");
  const [companyTrainees, setCompanyTrainees] = React.useState<TraineeOption[]>([]);
  const [traineesLoading, setTraineesLoading] = React.useState(false);
  const [traineeId, setTraineeId] = React.useState("");

  // ── New trainee mode ──
  const [form, setForm] = React.useState({
    fullName: "", nationalId: "", nationality: "", jobTitle: "", mobile: "", email: "",
  });
  const [newCompanyId, setNewCompanyId] = React.useState("");
  const [documents, setDocuments] = React.useState<TraineeDocument[]>([]);
  const [uploading, setUploading] = React.useState<"id" | "other" | null>(null);
  const [otherDocType, setOtherDocType] = React.useState<TraineeDocument["type"]>("other");
  const idInputRef = React.useRef<HTMLInputElement | null>(null);
  const otherInputRef = React.useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = React.useState(false);

  const enrolledSet = React.useMemo(() => new Set(enrolledTraineeIds), [enrolledTraineeIds]);

  // Reset state every time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setMode("existing");
    setCompanyId("");
    setTraineeId("");
    setNewCompanyId("");
    setForm({ fullName: "", nationalId: "", nationality: "", jobTitle: "", mobile: "", email: "" });
    setDocuments([]);
    setOtherDocType("other");
  }, [open]);

  // Load the company list once.
  const loadCompanies = React.useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const res = await api.getList<CompanyOption>("/trainees/companies", { pageSize: 200 });
      setCompanies(res.rows);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setCompaniesLoading(false);
    }
  }, [t, toast]);

  React.useEffect(() => {
    if (open && companies.length === 0) void loadCompanies();
  }, [open, companies.length, loadCompanies]);

  // Load trainees under the selected company (existing mode).
  const loadTraineesForCompany = React.useCallback(async (companyIdValue: string) => {
    if (!companyIdValue) {
      setCompanyTrainees([]);
      return;
    }
    setTraineesLoading(true);
    try {
      const res = await api.getList<TraineeOption>("/trainees", {
        companyId: companyIdValue,
        pageSize: 200,
      });
      setCompanyTrainees(res.rows);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
      setCompanyTrainees([]);
    } finally {
      setTraineesLoading(false);
    }
  }, [t, toast]);

  React.useEffect(() => {
    if (mode === "existing") {
      setTraineeId("");
      void loadTraineesForCompany(companyId);
    }
  }, [mode, companyId, loadTraineesForCompany]);

  const companyOptions = React.useMemo<SearchableSelectOption[]>(
    () => companies.map((c) => ({
      value: c.id,
      label: c.name,
      description: c.refNumber ? `${c.refNumber} · ${c.traineeCount}` : undefined,
    })),
    [companies]
  );

  const traineeOptions = React.useMemo<SearchableSelectOption[]>(
    () => companyTrainees
      .filter((tr) => !enrolledSet.has(tr.id))
      .map((tr) => ({
        value: tr.id,
        label: tr.fullName,
        description: tr.refNumber ? `${tr.refNumber}${tr.nationalId ? " · " + tr.nationalId : ""}` : tr.nationalId,
      })),
    [companyTrainees, enrolledSet]
  );

  const setField = (field: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const idDoc = React.useMemo(() => documents.find((d) => d.type === "id" || d.type === "iqama"), [documents]);

  // ── Staged upload helpers (same endpoint + model as TraineeEntrySection) ──
  const stageUpload = React.useCallback(async (file: File, kind: "id" | "other", docType?: TraineeDocument["type"]) => {
    setUploading(kind);
    try {
      const res = await api.postFile<UploadIdResponse>("/trainees/upload-id", file);
      const type: TraineeDocument["type"] = kind === "id" ? "id" : (docType ?? "other");
      const doc: TraineeDocument = { url: res.url, filename: file.name, type, uploadedAt: new Date().toISOString() };
      setDocuments((prev) => {
        if (type === "id" || type === "iqama") {
          // Replacing an existing ID doc keeps a single ID entry.
          const others = prev.filter((d) => d.type !== "id" && d.type !== "iqama");
          return [...others, doc];
        }
        return [...prev, doc];
      });
      toast({ title: t("misc.success"), description: t("requests.documentUploaded", { name: file.name }) });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(null);
      if (kind === "id" && idInputRef.current) idInputRef.current.value = "";
      if (kind === "other" && otherInputRef.current) otherInputRef.current.value = "";
    }
  }, [t, toast]);

  const removeDoc = React.useCallback((url: string) => {
    setDocuments((prev) => prev.filter((d) => d.url !== url));
  }, []);

  // ── Submit ──
  const submit = async () => {
    try {
      if (mode === "existing") {
        if (!traineeId) {
          toast({ title: t("misc.info"), description: t("session.enroll.selectTraineeFirst") });
          return;
        }
        setSubmitting(true);
        await api.post(`/sessions/${sessionId}/enrollments`, { traineeId });
        toast({ title: t("misc.success"), description: t("session.enroll.enrolledSuccess") });
        onOpenChange(false);
        onEnrolled?.();
        return;
      }

      // New trainee mode.
      if (!newCompanyId) {
        toast({ title: t("misc.info"), description: t("session.enroll.selectCompanyFirst") });
        return;
      }
      if (!form.fullName.trim() || !form.nationalId.trim()) {
        toast({ title: t("misc.error"), description: t("requests.addAtLeastOneTrainee"), variant: "destructive" });
        return;
      }
      setSubmitting(true);
      const created = await api.post<{ id: string }>("/trainees", {
        fullName: form.fullName.trim(),
        nationalId: form.nationalId.trim(),
        nationality: form.nationality.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        mobile: form.mobile.trim() || null,
        email: form.email.trim() || null,
        companyId: newCompanyId,
        documents,
      });
      await api.post(`/sessions/${sessionId}/enrollments`, { traineeId: created.id });
      toast({ title: t("misc.success"), description: t("session.enroll.createdAndEnrolled") });
      onOpenChange(false);
      setDocuments([]);
      setForm({ fullName: "", nationalId: "", nationality: "", jobTitle: "", mobile: "", email: "" });
      onEnrolled?.();
    } catch (e) {
      const msg = e instanceof Error && "code" in e
        ? (e as Error & { code?: string }).message
        : (e as Error).message;
      toast({ title: t("misc.error"), description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("session.enroll")}
      icon={Users}
      size="lg"
      onSubmit={() => void submit()}
      isSubmitting={submitting}
    >
      <div className="space-y-5">
        {/* Mode selector */}
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "existing" | "new")}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        >
          <label className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors">
            <RadioGroupItem value="existing" id="enroll-mode-existing" />
            <span className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" />
              {t("session.enroll.existing")}
            </span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors">
            <RadioGroupItem value="new" id="enroll-mode-new" />
            <span className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              {t("session.enroll.new")}
            </span>
          </label>
        </RadioGroup>

        {mode === "existing" ? (
          <div className="space-y-4">
            <Field label={t("session.enroll.selectCompany")} required>
              <SearchableSelect
                value={companyId}
                onChange={setCompanyId}
                options={companyOptions}
                loading={companiesLoading}
                placeholder="—"
              />
            </Field>

            {companyId && (
              <Field label={t("session.enroll.selectTrainee")} required>
                <SearchableSelect
                  value={traineeId}
                  onChange={setTraineeId}
                  options={traineeOptions}
                  loading={traineesLoading}
                  placeholder="—"
                  disabled={!companyId}
                  emptyText={t("session.enroll.noTrainees")}
                />
              </Field>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t("trainees.company")} required>
              <SearchableSelect
                value={newCompanyId}
                onChange={setNewCompanyId}
                options={companyOptions}
                loading={companiesLoading}
                placeholder="—"
              />
            </Field>

            <FormGrid>
              <Field label={t("requests.newTraineeName")} required>
                <Input value={form.fullName} onChange={(e) => setField("fullName", e.target.value)} />
              </Field>
              <Field label={t("requests.newTraineeNationalId")} required>
                <Input value={form.nationalId} onChange={(e) => setField("nationalId", e.target.value)} className="font-mono" />
              </Field>
              <Field label={t("requests.newTraineeNationality")}>
                <Input value={form.nationality} onChange={(e) => setField("nationality", e.target.value)} />
              </Field>
              <Field label={t("requests.newTraineeJobTitle")}>
                <Input value={form.jobTitle} onChange={(e) => setField("jobTitle", e.target.value)} />
              </Field>
              <Field label={t("requests.newTraineeMobile")}>
                <Input value={form.mobile} onChange={(e) => setField("mobile", e.target.value)} dir="ltr" />
              </Field>
              <Field label={t("requests.newTraineeEmail")}>
                <Input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} dir="ltr" />
              </Field>
            </FormGrid>

            {/* ID / Iqama document — staged upload, single ID entry */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{t("requests.newTraineeIdDoc")}</span>
                <input
                  ref={idInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void stageUpload(f, "id");
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading !== null} onClick={() => idInputRef.current?.click()}>
                  {uploading === "id" ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 me-1" />}
                  {t("requests.uploadIdDoc")}
                </Button>
              </div>
              {idDoc && (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
                  <a href={idDoc.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary truncate">
                    <FileCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{idDoc.filename}</span>
                  </a>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeDoc(idDoc.url)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Additional documents */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  {t("requests.additionalDocs.title")}
                </span>
                <div className="flex items-center gap-2">
                  <Select value={otherDocType} onValueChange={(v) => setOtherDocType(v as TraineeDocument["type"])}>
                    <SelectTrigger className="w-40 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map((dt) => (
                        <SelectItem key={dt} value={dt}>{t(`requests.docTypes.${dt}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    ref={otherInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void stageUpload(f, "other", otherDocType);
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploading !== null} onClick={() => otherInputRef.current?.click()}>
                    {uploading === "other" ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 me-1" />}
                    {t("requests.additionalDocs.add")}
                  </Button>
                </div>
              </div>

              {documents.filter((d) => d.type !== "id" && d.type !== "iqama").length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("requests.additionalDocs.empty")}</p>
              ) : (
                <div className="space-y-1.5">
                  {documents.filter((d) => d.type !== "id" && d.type !== "iqama").map((d) => (
                    <div key={d.url} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary truncate">
                        {d.type === "certificate" || d.type === "ohs"
                          ? <FileText className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          : <FileImage className="h-3.5 w-3.5 shrink-0 text-sky-600" />}
                        <span className="truncate">{d.filename}</span>
                        <span className="text-[10px] text-muted-foreground uppercase shrink-0">{t(`requests.docTypes.${d.type}`)}</span>
                      </a>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeDoc(d.url)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          {mode === "existing"
            ? t("requests.fromCompanyDesc")
            : t("requests.addNewTrainee")}
        </div>
      </div>
    </FormDialog>
  );
}
