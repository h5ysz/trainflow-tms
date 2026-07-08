"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { CalendarDays, Plus, BookOpen, GraduationCap, MapPin, Users } from "lucide-react";

interface Session {
  id: string;
  sessionCode: string;
  courseTitle: string;
  trainerName: string;
  location: string;
  startDate: string;
  endDate: string;
  expectedTrainees: number;
  actualTrainees: number;
  status: string;
}

const STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];

export function TrainingSessionsRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Session[] = [];

  const columns: Column<Session>[] = [
    {
      key: "code",
      header: t("sessions.sessionCode"),
      cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.sessionCode}</div>,
    },
    {
      key: "course",
      header: t("sessions.course"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm"><BookOpen className="h-3.5 w-3.5 text-muted-foreground" />{r.courseTitle}</div>
      ),
    },
    {
      key: "trainer",
      header: t("sessions.trainer"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName || "—"}</div>
      ),
    },
    {
      key: "location",
      header: t("sessions.location"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" />{r.location || "—"}</div>
      ),
    },
    {
      key: "dates",
      header: t("sessions.startDate"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground">{r.startDate} → {r.endDate}</div>
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
    {
      key: "status",
      header: t("sessions.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("sessions.title")}
        subtitle={t("sessions.subtitle")}
        icon={CalendarDays}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={CalendarDays}
        emptyTitle={t("sessions.empty.title")}
        emptySubtitle={t("sessions.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("sessions.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("sessions.new")}
        description={t("sessions.subtitle")}
        icon={CalendarDays}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("sessions.course")} required>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("sessions.request")}>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("sessions.title2")} required>
              <Input placeholder="Session title" />
            </Field>
            <Field label={t("sessions.trainer")}>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("sessions.startDate")} required>
              <Input type="datetime-local" />
            </Field>
            <Field label={t("sessions.endDate")} required>
              <Input type="datetime-local" />
            </Field>
            <Field label={t("sessions.location")}>
              <Input placeholder="Riyadh Training Center" />
            </Field>
            <Field label={t("sessions.venue")}>
              <Input placeholder="Hall A" />
            </Field>
            <Field label={t("sessions.language")}>
              <Select defaultValue="en"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("sessions.expectedTrainees")}>
              <Input type="number" defaultValue={0} min={0} />
            </Field>
          </FormGrid>
          <Field label={t("sessions.notes")}>
            <Textarea rows={3} placeholder={t("sessions.notes")} />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
