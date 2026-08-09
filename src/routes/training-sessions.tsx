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
import { CalendarDays, Plus, BookOpen, GraduationCap, MapPin, Users, AlertCircle, Download, Upload } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useToast } from "@/hooks/use-toast";
import { toDateTimeInput } from "@/lib/utils";
import { trainerName } from "@/lib/i18n/trainer-name";

interface CourseOption { id: string; title: string; code: string; }
interface TrainerOption { id: string; nameEn: string; nameAr?: string | null; }
interface Session {
  id: string;
  refNumber: string;
  sessionCode?: string;
  courseTitle?: string | null;
  courseCode?: string | null;
  courseRef?: string | null;
  trainerName?: string | null;
  trainerRef?: string | null;
  trainer?: { nameEn: string; nameAr?: string | null } | null;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  venue?: string | null;
  shift?: string | null;
  durationHours?: number;
  capacity?: number;
  startDate: string;
  endDate: string;
  expectedTrainees: number;
  actualTrainees: number;
  status: string;
  attendanceCount: number;
  certificatesCount: number;
  instituteName?: string | null;
  classification?: string;
  locationMapUrl?: string | null;
  durationDays?: number | null;
}

interface ImportResult {
  imported: number;
  failed: number;
  errors: { row: number; message: string }[];
}

const NEW_SESSION = {
  language: "en",
  expectedTrainees: 0,
  shift: "MORNING",
  classification: "COURSE",
  durationHours: 6,
  capacity: 20,
};

export function TrainingSessionsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { navigate } = useAppStore();
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Session>("/sessions");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Session>({
    resource: "/sessions",
    module: "sessions",
    refetch,
    fetchOnEdit: true,
    toForm: (r) => ({
      ...r,
      // Convert null/undefined to safe defaults to prevent controlled→
      // uncontrolled input warnings. Number fields must never be null.
      durationHours: (r as { durationHours?: number | null }).durationHours ?? 6,
      capacity: (r as { capacity?: number | null }).capacity ?? 20,
      expectedTrainees: (r as { expectedTrainees?: number | null }).expectedTrainees ?? 0,
      durationDays: (r as { durationDays?: number | null }).durationDays ?? "",
      // String fields that may be null in the DB
      trainerId: (r as { trainerId?: string | null }).trainerId ?? "",
      location: (r as { location?: string | null }).location ?? "",
      city: (r as { city?: string | null }).city ?? "",
      region: (r as { region?: string | null }).region ?? "",
      venue: (r as { venue?: string | null }).venue ?? "",
      shift: (r as { shift?: string | null }).shift ?? "MORNING",
      instituteName: (r as { instituteName?: string | null }).instituteName ?? "",
      locationMapUrl: (r as { locationMapUrl?: string | null }).locationMapUrl ?? "",
      notes: (r as { notes?: string | null }).notes ?? "",
      language: (r as { language?: string | null }).language ?? "en",
      classification: (r as { classification?: string | null }).classification ?? "COURSE",
      // Date fields
      startDate: toDateTimeInput((r as { startDate?: unknown }).startDate),
      endDate: toDateTimeInput((r as { endDate?: unknown }).endDate),
    }),
  });

  useEffect(() => {
    if (dialogOpen) {
      if (courses.length === 0) {
        api.getList<CourseOption>("/courses", { pageSize: 100 }).then((r) => {
          setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code })));
        }).catch(() => {});
      }
      if (trainers.length === 0) {
        api.getList<TrainerOption>("/trainers", { pageSize: 100 }).then((r) => {
          setTrainers(r.rows.map((t) => ({ id: t.id, nameEn: t.nameEn, nameAr: t.nameAr })));
        }).catch(() => {});
      }
    }
  }, [dialogOpen, courses.length, trainers.length]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.postFile<ImportResult>("/sessions/import", file);
      toast({
        title: t("misc.success"),
        description: t("sessions.import.success", { imported: result.imported, failed: result.failed }),
        variant: result.failed > 0 ? "destructive" : "default",
      });
      refetch();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const columns: Column<Session>[] = [
    { key: "code", header: t("sessions.sessionCode"), cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div> },
    {
      key: "course",
      header: t("sessions.course"),
      cell: (r) => <div className="flex items-center gap-2 text-sm"><BookOpen className="h-3.5 w-3.5 text-muted-foreground" />{r.courseTitle || "—"}</div>,
    },
    {
      key: "trainer",
      header: t("sessions.trainer"),
      cell: (r) => <div className="flex items-center gap-2 text-sm"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainer ? trainerName(r.trainer, locale) : (r.trainerName || "—")}</div>,
    },
    {
      key: "location",
      header: t("sessions.city"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{r.city || r.location || "—"}</div>
          {r.shift && <div className="mt-0.5">{t(`sessions.shift.${r.shift}` as never)} · {r.durationHours ?? 6}h</div>}
        </div>
      ),
    },
    {
      key: "dates",
      header: t("sessions.startDate"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground">
          {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()}
        </div>
      ),
    },
    {
      key: "trainees",
      header: t("sessions.expectedTrainees"),
      cell: (r) => (
        <div className="text-xs">
          <div className="font-semibold tabular-nums">{r.actualTrainees}/{r.expectedTrainees}</div>
          <div className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />{t("sessions.actualTrainees")}</div>
        </div>
      ),
    },
    { key: "status", header: t("sessions.status"), cell: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: t("action.actions"), headerClassName: "text-end", className: "text-end",
      cell: (row) => (
        <RowActions
          canEdit={canEdit}
          canDelete={canDelete}
          onView={() => navigate("session-detail", row.id)}
          onEdit={() => void openEdit(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
    },
  ];

  const handleSubmit = () =>
    void submit(requireFields({
      [t("sessions.course")]: "courseId",
      [t("sessions.title2")]: "title",
      [t("sessions.startDate")]: "startDate",
      [t("sessions.endDate")]: "endDate",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("sessions.title")}
        subtitle={t("sessions.subtitle")}
        icon={CalendarDays}
        actions={
          <>
            <Button variant="outline" onClick={() => window.open("/api/sessions/export", "_blank")}>
              <Download className="h-4 w-4 me-1.5" />{t("sessions.export")}
            </Button>
            {canCreate && (
              <>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleImportFile(e)} />
                <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                  <Upload className="h-4 w-4 me-1.5" />{t("sessions.import")}
                </Button>
              </>
            )}
            {canCreate && <Button onClick={() => openCreate(NEW_SESSION)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
          </>
        }
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
        emptyIcon={CalendarDays}
        emptyTitle={t("sessions.empty.title")}
        emptySubtitle={t("sessions.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate(NEW_SESSION)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("sessions.edit") : t("sessions.new")}
        description={t("sessions.subtitle")}
        icon={CalendarDays}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("sessions.course")} required>
              <Select value={(formData.courseId as string) ?? ""} onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.trainer")}>
              <Select value={(formData.trainerId as string) ?? ""} onValueChange={(v) => setField("trainerId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{trainerName(t, locale)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.title2")} required>
              <Input placeholder="Session title" value={(formData.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} />
            </Field>
            <Field label={t("sessions.location")}>
              <Input placeholder="Riyadh Training Center" value={(formData.location as string) ?? ""} onChange={(e) => setField("location", e.target.value)} />
            </Field>
            <Field label={t("sessions.city")}>
              <Input placeholder="Riyadh" value={(formData.city as string) ?? ""} onChange={(e) => setField("city", e.target.value)} />
            </Field>
            <Field label={t("sessions.region")}>
              <Input placeholder="Riyadh Region" value={(formData.region as string) ?? ""} onChange={(e) => setField("region", e.target.value)} />
            </Field>
            <Field label={t("sessions.venue")}>
              <Input placeholder="Hall A" value={(formData.venue as string) ?? ""} onChange={(e) => setField("venue", e.target.value)} />
            </Field>
            <Field label={t("sessions.shift")}>
              <Select value={(formData.shift as string) ?? "MORNING"} onValueChange={(v) => setField("shift", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MORNING">{t("sessions.shift.MORNING")}</SelectItem>
                  <SelectItem value="EVENING">{t("sessions.shift.EVENING")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.durationHours")}>
              <Input type="number" min={1} value={(formData.durationHours as number) ?? ""} onChange={(e) => setField("durationHours", parseInt(e.target.value, 10) || 6)} />
            </Field>
            <Field label={t("sessions.capacity")}>
              <Input type="number" min={1} value={(formData.capacity as number) ?? ""} onChange={(e) => setField("capacity", parseInt(e.target.value, 10) || 20)} />
            </Field>
            <Field label={t("sessions.startDate")} required>
              <Input type="datetime-local" value={(formData.startDate as string) ?? ""} onChange={(e) => setField("startDate", e.target.value)} />
            </Field>
            <Field label={t("sessions.endDate")} required>
              <Input type="datetime-local" value={(formData.endDate as string) ?? ""} onChange={(e) => setField("endDate", e.target.value)} />
            </Field>
            <Field label={t("sessions.language")}>
              <Select value={(formData.language as string) ?? "en"} onValueChange={(v) => setField("language", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.expectedTrainees")}>
              <Input type="number" min={0} value={(formData.expectedTrainees as number) ?? ""} onChange={(e) => setField("expectedTrainees", parseInt(e.target.value, 10) || 0)} />
            </Field>
            <Field label={t("sessions.instituteName")}>
              <Input placeholder="GCC Lab" value={(formData.instituteName as string) ?? ""} onChange={(e) => setField("instituteName", e.target.value)} />
            </Field>
            <Field label={t("sessions.classification")}>
              <Select value={(formData.classification as string) ?? "COURSE"} onValueChange={(v) => setField("classification", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COURSE">{t("sessions.classification.COURSE")}</SelectItem>
                  <SelectItem value="EXAM">{t("sessions.classification.EXAM")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.durationDays")}>
              <Input type="number" min={1} value={(formData.durationDays as number) ?? ""} onChange={(e) => setField("durationDays", parseInt(e.target.value, 10) || null)} />
            </Field>
            <Field label={t("sessions.mapLink")}>
              <Input placeholder="https://maps.app.goo.gl/..." value={(formData.locationMapUrl as string) ?? ""} onChange={(e) => setField("locationMapUrl", e.target.value)} />
            </Field>
          </FormGrid>
          <Field label={t("sessions.notes")}>
            <Textarea rows={3} placeholder={t("sessions.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.refNumber}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
