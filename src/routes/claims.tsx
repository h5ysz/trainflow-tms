"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FileText, Plus, AlertCircle, Loader2, MapPin, Clock, Calendar, BookOpen, Send } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useToast } from "@/hooks/use-toast";
import { type Locale } from "@/lib/i18n/translations";
import { trainerName } from "@/lib/i18n/trainer-name";

interface TrainerOption {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  engagementType?: string | null;
}

interface CoordinatorOption {
  id: string;
  fullName: string;
}

interface Claim {
  id: string;
  refNumber: string;
  claimType: string;
  engagementType: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  dailyAllowance?: number | null;
  mainLocation?: string | null;
  totalHours: number;
  totalDays: number;
  totalAmount: number;
  currency: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  trainer?: { id: string; nameEn: string; nameAr?: string | null; refNumber?: string } | null;
  coordinator?: { id: string; fullName: string } | null;
}

interface PreviewSession {
  id: string;
  refNumber?: string;
  courseCode: string | null;
  courseTitle: string | null;
  city: string | null;
  location: string | null;
  shift: string | null;
  durationHours: number;
  startDate: string;
  endDate: string;
}

interface PreviewRow {
  sessionId: string;
  date: string;
  weekdayIndex: number;
  courseCode: string | null;
  courseTitle: string | null;
  location: string | null;
  locationFlagged: boolean;
  flagReason: string | null;
  shift: string | null;
  actualHours: number;
  value: number;
  unit: string;
  rate: number | null;
  amount: number | null;
}

interface PreviewResult {
  engagementType: string;
  config: { mainLocation: string; employeeDailyAllowance: number; contractorDailyAllowance: number; normalWorkingHoursPerDay: number; contractorRatePerDay: number };
  sessions: PreviewSession[];
  rows: PreviewRow[];
  totals: { totalHours: number; totalDays: number; totalAmount: number };
}

export function ClaimsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { navigate, user } = useAppStore();
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [coordinators, setCoordinators] = useState<CoordinatorOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Claim>("/claims");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Claim>({
    resource: "/claims",
    module: "claims",
    refetch,
    fetchOnEdit: true,
    toForm: (r) => ({
      claimType: r.claimType ?? "OVERTIME",
      trainerId: (r as { trainerId?: string }).trainerId ?? (r.trainer?.id ?? ""),
      coordinatorId: (r as { coordinatorId?: string }).coordinatorId ?? (r.coordinator?.id ?? ""),
      engagementType: (r as { engagementType?: string }).engagementType ?? "EMPLOYEE",
      periodFrom: (r.periodFrom ?? "").slice(0, 10),
      periodTo: (r.periodTo ?? "").slice(0, 10),
      notes: (r as { notes?: string | null }).notes ?? "",
    }),
  });

  useEffect(() => {
    if (dialogOpen && trainers.length === 0) {
      api.getList<TrainerOption>("/claims/trainers", { pageSize: 200 }).then((r) => {
        setTrainers(r.rows.map((tr) => ({ id: tr.id, nameEn: tr.nameEn, nameAr: tr.nameAr, engagementType: tr.engagementType })));
      }).catch(() => {});
    }
    if (dialogOpen && coordinators.length === 0) {
      api.getList<CoordinatorOption>("/claims/coordinators", { pageSize: 200 }).then((r) => {
        setCoordinators(r.rows.map((u) => ({ id: u.id, fullName: u.fullName })));
      }).catch(() => {});
    }
  }, [dialogOpen, trainers.length, coordinators.length]);

  const handleWorkflow = async (id: string, action: string, extra?: Record<string, string>) => {
    try {
      await api.post(`/claims/${id}/${action}`, extra ?? {});
      toast({ title: t("misc.success"), variant: "default" });
      refetch();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "DRAFT": return "bg-gray-100 text-gray-700";
      case "GENERATED": return "bg-blue-100 text-blue-700";
      case "SUBMITTED": return "bg-amber-100 text-amber-700";
      case "PENDING_COORDINATOR_APPROVAL": return "bg-amber-100 text-amber-700";
      case "LINE_MANAGER_REVIEW": return "bg-indigo-100 text-indigo-700";
      case "QHSE_REVIEW": return "bg-cyan-100 text-cyan-700";
      case "HR_REVIEW": return "bg-violet-100 text-violet-700";
      case "RETURNED": return "bg-orange-100 text-orange-700";
      case "REJECTED": return "bg-red-100 text-red-700";
      case "APPROVED": return "bg-green-100 text-green-700";
      case "FINAL": return "bg-emerald-100 text-emerald-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const typeLabel = (ct: string) =>
    ct === "OVERTIME" ? t("claims.type.OVERTIME") : t("claims.type.BUSINESS_MISSION");

  const columns: Column<Claim>[] = [
    {
      key: "refNumber",
      header: t("claims.refNumber"),
      cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div>,
    },
    {
      key: "trainer",
      header: t("claims.trainer"),
      cell: (r) => (
        <div className="text-sm">
          {r.trainer ? trainerName(r.trainer, locale) : "—"}
        </div>
      ),
    },
    {
      key: "coordinator",
      header: t("claims.coordinator"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground">
          {r.coordinator?.fullName ?? "—"}
        </div>
      ),
    },
    {
      key: "claimType",
      header: t("claims.type"),
      cell: (r) => <span className="text-xs">{typeLabel(r.claimType)}</span>,
    },
    {
      key: "period",
      header: t("claims.period"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground">
          {new Date(r.periodFrom).toLocaleDateString()} → {new Date(r.periodTo).toLocaleDateString()}
        </div>
      ),
    },
    {
      key: "totals",
      header: t("claims.totalHours"),
      cell: (r) => (
        <div className="text-xs tabular-nums">
          {r.claimType === "OVERTIME" ? `${r.totalHours}h` : `${r.totalDays}d · ${r.totalAmount} ${r.currency}`}
        </div>
      ),
    },
    {
      key: "itemCount",
      header: t("claims.items"),
      cell: (r) => <span className="text-xs tabular-nums">{r.itemCount}</span>,
    },
    {
      key: "status",
      header: t("claims.status"),
      cell: (r) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(r.status)}`}>
          {t(`claims.status.${r.status}` as never)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => {
        const canSubmitRow = canEdit && (row.status === "DRAFT" || row.status === "GENERATED" || row.status === "RETURNED");
        return (
          <RowActions
            canEdit={canEdit}
            canDelete={canDelete}
            onView={() => navigate("claim-detail", row.id)}
            onEdit={() => void openEdit(row)}
            onDelete={() => setDeleteTarget(row)}
            extraItems={
              canSubmitRow ? (
                <DropdownMenuItem onSelect={() => void handleWorkflow(row.id, "submit")}>
                  <Send className="h-3.5 w-3.5 me-2" />
                  {t("claims.actions.submit")}
                </DropdownMenuItem>
              ) : undefined
            }
          />
        );
      },
    },
  ];

  const handleSubmit = () =>
    void submit(requireFields({
      [t("claims.new.type")]: "claimType",
      [t("claims.new.trainer")]: "trainerId",
      [t("claims.new.coordinator")]: "coordinatorId",
      [t("claims.new.periodFrom")]: "periodFrom",
      [t("claims.new.periodTo")]: "periodTo",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("claims.title")}
        subtitle={t("claims.subtitle")}
        icon={FileText}
        actions={
          <>
            {canCreate && (
              <Button onClick={() => openCreate({ claimType: "OVERTIME", trainerId: user?.role === "TRAINER" ? (user?.trainerId ?? "") : "", coordinatorId: "", engagementType: "EMPLOYEE", periodFrom: "", periodTo: "", notes: "" })}>
                <Plus className="h-4 w-4 me-1.5" />{t("claims.new")}
              </Button>
            )}
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
        emptyIcon={FileText}
        emptyTitle={t("claims.empty.title")}
        emptySubtitle={t("claims.empty.subtitle")}
        emptyAction={canCreate && (
          <Button onClick={() => openCreate({ claimType: "OVERTIME", trainerId: user?.role === "TRAINER" ? (user?.trainerId ?? "") : "", coordinatorId: "", engagementType: "EMPLOYEE", periodFrom: "", periodTo: "", notes: "" })}>
            <Plus className="h-4 w-4 me-1.5" />{t("claims.new")}
          </Button>
        )}
      />
      <ClaimFormDialog
        dialogOpen={dialogOpen}
        isEditing={isEditing}
        formData={formData}
        setField={setField}
        trainers={trainers}
        coordinators={coordinators}
        userRole={user?.role}
        locale={locale}
        t={t}
        onSubmit={handleSubmit}
        submitting={submitting}
        closeDialog={closeDialog}
      />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t("claims.delete")}
          description={`${t("claims.refNumber")}: ${deleteTarget.refNumber}`}
          onConfirm={() => void confirmDelete()}
          loading={deleting}
        />
      )}
    </div>
  );
}

function ClaimFormDialog({
  dialogOpen, isEditing, formData, setField, trainers, coordinators, userRole, locale, t, onSubmit, submitting, closeDialog,
}: {
  dialogOpen: boolean;
  isEditing: boolean;
  formData: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  trainers: TrainerOption[];
  coordinators: CoordinatorOption[];
  userRole?: string;
  locale: Locale;
  t: (key: any, vars?: Record<string, string | number>) => string;
  onSubmit: () => void;
  submitting: boolean;
  closeDialog: () => void;
}) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const claimType = (formData.claimType as string) ?? "OVERTIME";
  const trainerId = (formData.trainerId as string) ?? "";
  const periodFrom = (formData.periodFrom as string) ?? "";
  const periodTo = (formData.periodTo as string) ?? "";

  const selectedTrainer = trainers.find((tr) => tr.id === trainerId);

  const fetchPreview = useCallback(async () => {
    if (!trainerId || !periodFrom || !periodTo) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.get<PreviewResult>("/claims/preview", {
        claimType,
        trainerId,
        periodFrom,
        periodTo,
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setPreviewError((err as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }, [claimType, trainerId, periodFrom, periodTo]);

  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (trainerId && periodFrom && periodTo) {
      previewTimer.current = setTimeout(() => { void fetchPreview(); }, 400);
    } else {
      setPreview(null);
      setPreviewError(null);
    }
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [claimType, trainerId, periodFrom, periodTo, fetchPreview]);

  useEffect(() => {
    if (!dialogOpen) {
      setPreview(null);
      setPreviewError(null);
    }
  }, [dialogOpen]);

  const isBM = claimType === "BUSINESS_MISSION";

  const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  const weekdayLabel = (idx: number) => {
    return locale === "ar" ? (WEEKDAY_NAMES_AR[idx] ?? "") : (WEEKDAY_NAMES[idx] ?? "");
  };

  return (
    <FormDialog
      open={dialogOpen}
      onOpenChange={(o) => !o && closeDialog()}
      title={isEditing ? t("claims.edit.title") : t("claims.new.title")}
      description={t("claims.subtitle")}
      icon={FileText}
      onSubmit={onSubmit}
      isSubmitting={submitting}
      size="lg"
      allowFullscreen
    >
      <div className="space-y-5">
        <FormGrid>
          <Field label={t("claims.new.type")} required>
            <Select value={claimType} onValueChange={(v) => setField("claimType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OVERTIME">{t("claims.type.OVERTIME")}</SelectItem>
                <SelectItem value="BUSINESS_MISSION">{t("claims.type.BUSINESS_MISSION")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("claims.new.trainer")} required>
            <Select value={trainerId} onValueChange={(v) => setField("trainerId", v)}>
              <SelectTrigger><SelectValue placeholder={t("claims.new.trainerPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {trainers.map((tr) => (
                  <SelectItem key={tr.id} value={tr.id}>{trainerName(tr, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("claims.new.coordinator")} required>
            <Select value={(formData.coordinatorId as string) ?? ""} onValueChange={(v) => setField("coordinatorId", v)}>
              <SelectTrigger><SelectValue placeholder={t("claims.new.coordinatorPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {coordinators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>
        <FormGrid>
          <Field label={t("claims.new.engagementType")} required>
            <Select value={(formData.engagementType as string) ?? selectedTrainer?.engagementType ?? "EMPLOYEE"} onValueChange={(v) => setField("engagementType", v)}>
              <SelectTrigger><SelectValue placeholder={t("claims.new.engagementTypePlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EMPLOYEE">{t("claims.engagementType.EMPLOYEE")}</SelectItem>
                <SelectItem value="CONTRACTOR">{t("claims.engagementType.CONTRACTOR")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>

        {selectedTrainer?.engagementType && (
          <div className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${selectedTrainer.engagementType === "CONTRACTOR" ? "border-purple-200 bg-purple-50 text-purple-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
            {selectedTrainer.engagementType === "CONTRACTOR" ? t("claims.engagementType.CONTRACTOR") : t("claims.engagementType.EMPLOYEE")}
            <span className="text-muted-foreground font-normal">— {t("claims.engagementType.info")}</span>
          </div>
        )}

        <FormGrid>
          <Field label={t("claims.new.periodFrom")} required>
            <Input type="date" value={periodFrom} onChange={(e) => setField("periodFrom", e.target.value)} />
          </Field>
          <Field label={t("claims.new.periodTo")} required>
            <Input type="date" value={periodTo} onChange={(e) => setField("periodTo", e.target.value)} />
          </Field>
        </FormGrid>

        {(previewLoading || preview || previewError) && (
          <div className="rounded-lg border bg-muted/30 overflow-hidden">
            <div className="flex items-center gap-2 border-b px-3 py-2 bg-muted/50">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">{t("claims.preview.sessionsTitle")}</span>
              {previewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ms-auto" />}
              {preview && !previewLoading && (
                <span className="text-xs text-muted-foreground ms-auto">{preview.rows.length} {t("claims.preview.rows")}</span>
              )}
            </div>

            {previewError && (
              <div className="px-3 py-2 text-xs text-destructive">{previewError}</div>
            )}

            {preview && !previewLoading && !previewError && preview.rows.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("claims.preview.noSessions")}
              </div>
            )}

            {preview && !previewLoading && preview.rows.length > 0 && (
              <div className="max-h-[40vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/70">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-1.5 font-medium">{t("claims.items.date")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("claims.items.courseTitle")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("claims.items.location")}</th>
                      <th className="px-3 py-1.5 font-medium">{t("claims.items.shift")}</th>
                      <th className="px-3 py-1.5 font-medium text-end">{t("claims.items.actualHours")}</th>
                      <th className="px-3 py-1.5 font-medium text-end">{isBM ? t("claims.items.amount") : t("claims.preview.claimValue")}</th>
                      {isBM && <th className="px-3 py-1.5 font-medium text-end">{t("claims.items.amount")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, idx) => (
                      <tr key={`${row.sessionId}-${idx}`} className="border-t border-border/50">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="text-muted-foreground">{weekdayLabel(row.weekdayIndex)}</span>{" "}
                          {row.date}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="truncate max-w-[150px]">{row.courseTitle ?? "—"}</div>
                          {row.courseCode && <div className="text-muted-foreground text-[10px]">{row.courseCode}</div>}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            {row.locationFlagged && <MapPin className="h-3 w-3 text-amber-500 shrink-0" />}
                            <span className={row.locationFlagged ? "text-amber-700" : ""}>
                              {row.location ?? "—"}
                            </span>
                          </div>
                          {row.flagReason && <div className="text-[10px] text-amber-600">{row.flagReason}</div>}
                        </td>
                        <td className="px-3 py-1.5">{row.shift ?? "—"}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{row.actualHours}h</td>
                        <td className="px-3 py-1.5 text-end tabular-nums font-medium">
                          {isBM ? `${row.value}d` : `${row.value}h`}
                        </td>
                        {isBM && (
                          <td className="px-3 py-1.5 text-end tabular-nums">
                            {row.amount != null ? `${row.amount} SAR` : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview && !previewLoading && preview.rows.length > 0 && (
              <div className="border-t px-3 py-2 flex items-center gap-4 text-xs font-semibold bg-muted/50">
                {isBM ? (
                  <>
                    <span>{t("claims.preview.totalDays")}: <span className="tabular-nums">{preview.totals.totalDays}</span></span>
                    <span>{t("claims.preview.totalAmount")}: <span className="tabular-nums">{preview.totals.totalAmount} SAR</span></span>
                  </>
                ) : (
                  <>
                    <span>{t("claims.preview.totalHours")}: <span className="tabular-nums">{preview.totals.totalHours}h</span></span>
                    <span>{t("claims.preview.totalDays")}: <span className="tabular-nums">{preview.totals.totalDays}</span></span>
                  </>
                )}
                <span className="ms-auto text-muted-foreground font-normal">
                  {selectedTrainer?.engagementType === "CONTRACTOR"
                    ? t("claims.preview.contractorNote")
                    : t("claims.preview.employeeNote")}
                </span>
              </div>
            )}
          </div>
        )}

        <Field label={t("claims.new.notes")}>
          <Textarea
            placeholder={t("claims.new.notes")}
            value={(formData.notes as string) ?? ""}
            onChange={(e) => setField("notes", e.target.value)}
            rows={2}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
