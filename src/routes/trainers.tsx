"use client";

import { useState } from "react";
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/common/status-badge";
import { Users, Plus, Mail, Phone, Award, CalendarDays, AlertCircle, ShieldCheck, Loader2 } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { api } from "@/lib/api/client";

interface Trainer {
  id: string;
  refNumber: string;
  fullName: string;
  fullNameAr?: string | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  status: string;
  primarySpecialization?: string | null;
  qualificationsCount: number;
  certifiedCoursesCount: number;
  sessionsCount: number;
  hireDate?: string | null;
}

interface CatalogCourse {
  id: string;
  code: string;
  title: string;
}

interface CatalogWorkshop {
  id: string;
  code: string;
  title: string;
}

const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function TrainersRoute() {
  const { t } = useI18n();

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Trainer>("/trainers");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Trainer>({
    resource: "/trainers",
    module: "trainers",
    refetch,
    fetchOnEdit: true,
  });

  // Trainer authorizations dialog
  const [authTrainer, setAuthTrainer] = useState<Trainer | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSaving, setAuthSaving] = useState(false);
  const [authCourses, setAuthCourses] = useState<CatalogCourse[]>([]);
  const [authWorkshops, setAuthWorkshops] = useState<CatalogWorkshop[]>([]);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [workshopIds, setWorkshopIds] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  const toggle = (arr: string[], id: string): string[] =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const openAuth = async (trainer: Trainer) => {
    setAuthTrainer(trainer);
    setAuthError(null);
    setAuthLoading(true);
    try {
      const [grants, courses, workshops] = await Promise.all([
        api.get<{ courseIds: string[]; workshopIds: string[] }>(`/trainers/${trainer.id}/authorizations`),
        api.getList<CatalogCourse>("/courses", { pageSize: 200 }),
        api.getList<CatalogWorkshop>("/workshops", { pageSize: 200 }),
      ]);
      setCourseIds(grants.courseIds ?? []);
      setWorkshopIds(grants.workshopIds ?? []);
      setAuthCourses(courses.rows);
      setAuthWorkshops(workshops.rows);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Failed to load authorizations");
    } finally {
      setAuthLoading(false);
    }
  };

  const saveAuth = async () => {
    if (!authTrainer) return;
    setAuthSaving(true);
    setAuthError(null);
    try {
      await api.put(`/trainers/${authTrainer.id}/authorizations`, { courseIds, workshopIds });
      setAuthTrainer(null);
      void refetch();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Failed to save authorizations");
    } finally {
      setAuthSaving(false);
    }
  };

  const columns: Column<Trainer>[] = [
    {
      key: "name",
      header: t("trainers.fullName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/10 text-warning text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium">{r.fullName}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{r.refNumber}</div>
          </div>
        </div>
      ),
    },
    {
      key: "specialization",
      header: t("trainers.specialization"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground max-w-[220px] truncate">
          {r.primarySpecialization || "—"}
        </div>
      ),
    },
    {
      key: "contact",
      header: t("trainers.email"),
      cell: (r) => (
        <div className="space-y-0.5">
          {r.email && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{r.email}</div>}
          {r.phone && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.phone}</div>}
        </div>
      ),
    },
    {
      key: "stats",
      header: t("trainers.qualifiedCourses"),
      cell: (r) => (
        <div className="flex gap-3 text-xs">
          <div>
            <div className="font-semibold tabular-nums flex items-center gap-1"><Award className="h-3 w-3" />{r.certifiedCoursesCount}</div>
            <div className="text-muted-foreground">{t("trainers.qualifiedCourses")}</div>
          </div>
          <div>
            <div className="font-semibold tabular-nums flex items-center gap-1"><CalendarDays className="h-3 w-3" />{r.sessionsCount}</div>
            <div className="text-muted-foreground">{t("trainers.sessions")}</div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("trainers.status"),
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
          extraItems={
            canEdit && (
              <DropdownMenuItem onSelect={() => void openAuth(row)}>
                <ShieldCheck className="h-3.5 w-3.5 me-2" />
                {t("trainers.manageAuth")}
              </DropdownMenuItem>
            )
          }
        />
      ),
    },
  ];

  const handleSubmit = () =>
    void submit(requireFields({
      [t("trainers.fullName")]: "fullName",
      [t("trainers.email")]: "email",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("trainers.title")}
        subtitle={t("trainers.subtitle")}
        icon={Users}
        actions={canCreate && <Button onClick={() => openCreate({ status: "ACTIVE" })}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
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
        emptyIcon={Users}
        emptyTitle={t("trainers.empty.title")}
        emptySubtitle={t("trainers.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate({ status: "ACTIVE" })}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("trainers.edit") : t("trainers.new")}
        description={t("trainers.subtitle")}
        icon={Users}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("trainers.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("trainers.fullNameAr")}>
              <Input placeholder="الاسم بالعربية" dir="rtl" value={(formData.fullNameAr as string) ?? ""} onChange={(e) => setField("fullNameAr", e.target.value)} />
            </Field>
            <Field label={t("trainers.nationalId")}>
              <Input placeholder="ID Number" value={(formData.nationalId as string) ?? ""} onChange={(e) => setField("nationalId", e.target.value)} />
            </Field>
            <Field label={t("trainers.gender")}>
              <Select value={(formData.gender as string) ?? ""} onValueChange={(v) => setField("gender", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">{t("misc.yes") === "Yes" ? "Male" : "ذكر"}</SelectItem>
                  <SelectItem value="FEMALE">{t("misc.yes") === "Yes" ? "Female" : "أنثى"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("trainers.nationality")}>
              <Input placeholder="Saudi" value={(formData.nationality as string) ?? ""} onChange={(e) => setField("nationality", e.target.value)} />
            </Field>
            <Field label={t("trainers.hireDate")}>
              <Input type="date" value={(formData.hireDate as string) ?? ""} onChange={(e) => setField("hireDate", e.target.value)} />
            </Field>
          </FormGrid>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("trainers.email")} required>
                <Input type="email" placeholder="trainer@gcclab.com" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
              </Field>
              <Field label={t("trainers.phone")}>
                <Input placeholder="+966 11 000 0000" value={(formData.phone as string) ?? ""} onChange={(e) => setField("phone", e.target.value)} />
              </Field>
              <Field label={t("trainers.mobile")}>
                <Input placeholder="+966 5X XXX XXXX" value={(formData.mobile as string) ?? ""} onChange={(e) => setField("mobile", e.target.value)} />
              </Field>
              <Field label={t("trainers.country")}>
                <Input placeholder="Saudi Arabia" value={(formData.country as string) ?? ""} onChange={(e) => setField("country", e.target.value)} />
              </Field>
              <Field label={t("trainers.city")}>
                <Input placeholder="Dammam" value={(formData.city as string) ?? ""} onChange={(e) => setField("city", e.target.value)} />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4 space-y-4">
            <Field label={t("trainers.address")}>
              <Input placeholder="Street, District" value={(formData.address as string) ?? ""} onChange={(e) => setField("address", e.target.value)} />
            </Field>
            <Field label={t("trainers.bio")}>
              <Textarea placeholder={t("trainers.bio")} rows={3} value={(formData.bio as string) ?? ""} onChange={(e) => setField("bio", e.target.value)} />
            </Field>
            <Field label={t("trainers.status")}>
              <Select value={(formData.status as string) ?? "ACTIVE"} onValueChange={(v) => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      </FormDialog>

      <FormDialog
        open={authTrainer !== null}
        onOpenChange={(o) => !o && setAuthTrainer(null)}
        title={t("trainers.authTitle")}
        description={authTrainer ? `${authTrainer.fullName} (${authTrainer.refNumber})` : undefined}
        icon={ShieldCheck}
        size="lg"
        onSubmit={() => void saveAuth()}
        isSubmitting={authSaving}
        submitLabel={t("trainers.authSave")}
      >
        {authError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {authError}
          </div>
        )}
        {authLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin me-2" /> {t("misc.loading")}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-sm font-medium flex items-center gap-2">
                <Award className="h-4 w-4 text-muted-foreground" />
                {t("trainers.authCourses")}
                <span className="text-xs text-muted-foreground font-normal">({courseIds.length})</span>
              </div>
              <ScrollArea className="h-44 rounded-md border">
                <div className="p-2 space-y-1">
                  {authCourses.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">{t("trainers.authNoCourses")}</div>
                  )}
                  {authCourses.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60 cursor-pointer"
                    >
                      <Checkbox
                        checked={courseIds.includes(c.id)}
                        onCheckedChange={() => setCourseIds((arr) => toggle(arr, c.id))}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                      <span className="truncate">{c.title}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {t("trainers.authWorkshops")}
                <span className="text-xs text-muted-foreground font-normal">({workshopIds.length})</span>
              </div>
              <ScrollArea className="h-32 rounded-md border">
                <div className="p-2 space-y-1">
                  {authWorkshops.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">{t("trainers.authNoWorkshops")}</div>
                  )}
                  {authWorkshops.map((w) => (
                    <label
                      key={w.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60 cursor-pointer"
                    >
                      <Checkbox
                        checked={workshopIds.includes(w.id)}
                        onCheckedChange={() => setWorkshopIds((arr) => toggle(arr, w.id))}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{w.code}</span>
                      <span className="truncate">{w.title}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
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
