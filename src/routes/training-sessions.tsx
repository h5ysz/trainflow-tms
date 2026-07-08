"use client";

import { useState, useEffect, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { CalendarDays, Plus, BookOpen, GraduationCap, MapPin, Users, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface CourseOption { id: string; title: string; code: string; }
interface TrainerOption { id: string; fullName: string; }
interface Session {
  id: string;
  sessionCode: string;
  courseTitle?: string | null;
  courseCode?: string | null;
  trainerName?: string | null;
  location?: string | null;
  startDate: string;
  endDate: string;
  expectedTrainees: number;
  actualTrainees: number;
  status: string;
  attendanceCount: number;
  certificatesCount: number;
}

export function TrainingSessionsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({ language: "en", expectedTrainees: 0 });
  const [courses, setCourses] = useReactState<CourseOption[]>([]);
  const [trainers, setTrainers] = useReactState<TrainerOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Session>("/sessions");

  const canCreate = user ? canPerformAction(user.role, "sessions", "create") : false;

  useEffect(() => {
    if (dialogOpen) {
      if (courses.length === 0) {
        api.get<{ rows: CourseOption[] }>("/courses", { pageSize: 100 }).then((r) => {
          setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code })));
        }).catch(() => {});
      }
      if (trainers.length === 0) {
        api.get<{ rows: TrainerOption[] }>("/trainers", { pageSize: 100 }).then((r) => {
          setTrainers(r.rows.map((t) => ({ id: t.id, fullName: t.fullName })));
        }).catch(() => {});
      }
    }
  }, [dialogOpen, courses.length, trainers.length]);

  const columns: Column<Session>[] = [
    { key: "code", header: t("sessions.sessionCode"), cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.sessionCode}</div> },
    {
      key: "course",
      header: t("sessions.course"),
      cell: (r) => <div className="flex items-center gap-2 text-sm"><BookOpen className="h-3.5 w-3.5 text-muted-foreground" />{r.courseTitle || "—"}</div>,
    },
    {
      key: "trainer",
      header: t("sessions.trainer"),
      cell: (r) => <div className="flex items-center gap-2 text-sm"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName || "—"}</div>,
    },
    {
      key: "location",
      header: t("sessions.location"),
      cell: (r) => <div className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" />{r.location || "—"}</div>,
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
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>,
    },
  ];

  const handleSubmit = async () => {
    if (!formData.courseId || !formData.title || !formData.startDate || !formData.endDate) {
      toast({ title: t("misc.error"), description: "Course, title, start and end dates are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/sessions", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({ language: "en", expectedTrainees: 0 });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("sessions.title")}
        subtitle={t("sessions.subtitle")}
        icon={CalendarDays}
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
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
        emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("sessions.new")}
        description={t("sessions.subtitle")}
        icon={CalendarDays}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("sessions.course")} required>
              <Select onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.trainer")}>
              <Select onValueChange={(v) => setField("trainerId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{t.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.title2")} required>
              <Input placeholder="Session title" value={(formData.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} />
            </Field>
            <Field label={t("sessions.location")}>
              <Input placeholder="Riyadh Training Center" value={(formData.location as string) ?? ""} onChange={(e) => setField("location", e.target.value)} />
            </Field>
            <Field label={t("sessions.startDate")} required>
              <Input type="datetime-local" value={(formData.startDate as string) ?? ""} onChange={(e) => setField("startDate", e.target.value)} />
            </Field>
            <Field label={t("sessions.endDate")} required>
              <Input type="datetime-local" value={(formData.endDate as string) ?? ""} onChange={(e) => setField("endDate", e.target.value)} />
            </Field>
            <Field label={t("sessions.venue")}>
              <Input placeholder="Hall A" value={(formData.venue as string) ?? ""} onChange={(e) => setField("venue", e.target.value)} />
            </Field>
            <Field label={t("sessions.language")}>
              <Select value={formData.language as string} onValueChange={(v) => setField("language", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.expectedTrainees")}>
              <Input type="number" min={0} value={formData.expectedTrainees as number} onChange={(e) => setField("expectedTrainees", parseInt(e.target.value, 10) || 0)} />
            </Field>
          </FormGrid>
          <Field label={t("sessions.notes")}>
            <Textarea rows={3} placeholder={t("sessions.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
