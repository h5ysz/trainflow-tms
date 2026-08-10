"use client";

// Turns an APPROVED training request into scheduled sessions.
//
// POST /api/requests/[id]/generate-sessions needs a per-course spec (shift, dates,
// venue, capacity). Nothing in the UI ever collected one — the old caller posted an
// empty body to a route that could not have worked anyway — so this dialog is what
// makes the endpoint reachable.

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarRange, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { trainerName } from "@/lib/i18n/trainer-name";

interface RequestCourseOption {
  requestCourseId: string;
  courseId: string;
  courseTitle: string | null;
  courseCode: string | null;
  traineeCount: number;
  defaultCapacity: number | null;
  alreadyGenerated: boolean;
}

interface TrainerOption {
  id: string;
  fullName: string;
  nameEn: string;
  nameAr?: string | null;
  refNumber: string;
  certStatus?: string;
  validUntil?: string | null;
  qualificationTitle?: string | null;
  deletedAt?: string | null;
}

interface TrainerCertRow {
  id: string;
  status: string;
  validUntil: string | null;
  trainer: TrainerOption | null;
  qualification: { id: string; title: string; credentialNumber: string | null } | null;
}

interface GeneratePlan {
  requestRef: string;
  status: string;
  canGenerate: boolean;
  company: { id: string; name: string; city: string | null } | null;
  preferredDateFrom: string | null;
  preferredDateTo: string | null;
  preferredLocation: string | null;
  courses: RequestCourseOption[];
}

interface CourseSpec {
  include: boolean;
  shift: "MORNING" | "EVENING";
  startDate: string;
  endDate: string;
  city: string;
  venue: string;
  capacity: number;
  trainerId: string;
  notes: string;
  // ── Trainer qualification exception ──
  showAllTrainers: boolean;     // toggle: show all active trainers (not just certified)
  waiveCertification: boolean;  // confirmed waiver for the selected trainer
  waiverReason: string;         // optional reason for the exception
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function certStatusChip(status?: string) {
  if (!status) return null;
  const styles: Record<string, string> = {
    VALID: "bg-emerald-500/10 text-emerald-600",
    EXPIRED: "bg-destructive/10 text-destructive",
    REVOKED: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export function GenerateSessionsDialog({
  requestId,
  open,
  onOpenChange,
  onGenerated,
}: {
  requestId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [plan, setPlan] = useState<GeneratePlan | null>(null);
  const [specs, setSpecs] = useState<Record<string, CourseSpec>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Authorized trainers per courseId, loaded from /trainer-certifications.
  const [trainersByCourse, setTrainersByCourse] = useState<Record<string, TrainerOption[]>>({});
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [trainersError, setTrainersError] = useState<string | null>(null);
  // All active trainers — loaded lazily when the coordinator toggles "show all trainers"
  const [allTrainers, setAllTrainers] = useState<TrainerOption[]>([]);
  const [allTrainersLoaded, setAllTrainersLoaded] = useState(false);
  // Which request the currently-held plan belongs to. Loading is derived from this
  // rather than tracked separately, so the effect has no synchronous state writes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = open && Boolean(requestId) && loadedFor !== requestId;

  // Load the list of trainers authorized to teach each course on the request.
  // Only these may be picked — a trainer without a VALID TrainerCertification
  // for the course is never shown (and the backend rejects him anyway).
  const loadAuthorizedTrainers = async (courses: RequestCourseOption[]) => {
    if (courses.length === 0) return;
    setTrainersLoading(true);
    setTrainersError(null);
    try {
      const now = Date.now();
      const results = await Promise.all(
        courses.map(async (c) => {
          const res = await api.getList<TrainerCertRow>("/trainer-certifications", {
            courseId: c.courseId,
            status: "VALID",
            pageSize: 200,
          });
          // A trainer is "qualified" only when the certification is VALID, not
          // expired, and the trainer still exists — mirroring the backend
          // isTrainerCertifiedForCourse check so the list never shows a trainer
          // the server would reject.
          const trainers = res.rows
            .filter((r): r is TrainerCertRow & { trainer: TrainerOption } =>
              r.trainer !== null && !r.trainer.deletedAt
            )
            .filter((r) => !r.validUntil || new Date(r.validUntil).getTime() >= now)
            .map((r) => ({
              ...r.trainer,
              certStatus: r.status,
              validUntil: r.validUntil,
              qualificationTitle: r.qualification?.title ?? null,
            }));
          return [c.courseId, trainers] as const;
        })
      );
      setTrainersByCourse(Object.fromEntries(results));
    } catch (e) {
      setTrainersError((e as Error).message);
    } finally {
      setTrainersLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    // Loading and error are reset by the resolution below rather than synchronously
    // here; `loadedFor` is what distinguishes "still fetching" from "fetched".
    api
      .get<GeneratePlan>(`/requests/${requestId}/generate-sessions`)
      .then((p) => {
        if (cancelled) return;
        setError(null);
        setPlan(p);
        setLoadedFor(requestId);
        const from = toDateInput(p.preferredDateFrom);
        const to = toDateInput(p.preferredDateTo);
        setSpecs(
          Object.fromEntries(
            p.courses.map((c) => [
              c.requestCourseId,
              {
                include: !c.alreadyGenerated,
                shift: "MORNING" as const,
                startDate: from,
                endDate: to || from,
                city: p.company?.city ?? p.preferredLocation ?? "",
                venue: "",
                capacity: c.defaultCapacity ?? c.traineeCount,
                trainerId: "",
                notes: "",
                showAllTrainers: false,
                waiveCertification: false,
                waiverReason: "",
              },
            ])
          )
        );
        void loadAuthorizedTrainers(p.courses);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoadedFor(requestId);
      });
    return () => {
      cancelled = true;
    };
  }, [open, requestId]);

  // Lazy-load all active trainers when any course's showAllTrainers is toggled on
  useEffect(() => {
    const anyShowAll = Object.values(specs).some((s) => s.showAllTrainers);
    if (anyShowAll && !allTrainersLoaded) {
      api.getList<TrainerOption>("/trainers", { pageSize: 200 })
        .then((r) => {
          setAllTrainers(r.rows.map((t) => ({ id: t.id, fullName: t.fullName, nameEn: t.nameEn, nameAr: t.nameAr, refNumber: t.refNumber })));
          setAllTrainersLoaded(true);
        })
        .catch(() => {});
    }
  }, [specs, allTrainersLoaded]);

  const setSpec = (id: string, patch: Partial<CourseSpec>) =>
    setSpecs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const selected = plan?.courses.filter((c) => specs[c.requestCourseId]?.include) ?? [];

  const handleSubmit = async () => {
    if (!requestId || !plan) return;
    if (selected.length === 0) {
      toast({ title: t("misc.error"), description: t("requests.generate.selectAtLeastOne"), variant: "destructive" });
      return;
    }
    const missing = selected.find((c) => {
      const s = specs[c.requestCourseId];
      return !s.startDate || !s.endDate;
    });
    if (missing) {
      toast({ title: t("misc.error"), description: t("requests.generate.datesRequired"), variant: "destructive" });
      return;
    }

    // Every included course needs an authorized trainer to receive the schedule.
    const noTrainer = selected.find((c) => !specs[c.requestCourseId].trainerId);
    if (noTrainer) {
      toast({
        title: t("misc.error"),
        description: t("requests.generate.trainerRequired", { course: noTrainer.courseTitle ?? noTrainer.courseCode ?? "" }),
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ generatedCount: number }>(`/requests/${requestId}/generate-sessions`, {
        sessions: selected.map((c) => {
          const s = specs[c.requestCourseId];
          return {
            requestCourseId: c.requestCourseId,
            courseId: c.courseId,
            shift: s.shift,
            startDate: s.startDate,
            endDate: s.endDate,
            city: s.city || undefined,
            venue: s.venue || undefined,
            capacity: s.capacity,
            trainerId: s.trainerId || undefined,
            notes: s.notes || undefined,
            waiveCertification: s.waiveCertification || undefined,
            waiverReason: s.waiverReason || undefined,
          };
        }),
      });
      toast({
        title: t("misc.success"),
        description: t("requests.generate.success", { count: res.generatedCount }),
      });
      onOpenChange(false);
      onGenerated();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("requests.generate.title")}
      description={t("requests.generate.subtitle")}
      icon={CalendarRange}
      size="lg"
      onSubmit={plan?.canGenerate ? handleSubmit : undefined}
      isSubmitting={submitting}
      submitLabel={t("requests.generate.sendSchedule")}
    >
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : plan ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-mono font-semibold text-primary">{plan.requestRef}</span>
            {plan.company && <span className="text-muted-foreground">{plan.company.name}</span>}
          </div>

          {!plan.canGenerate && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
              <AlertCircle className="h-4 w-4 text-warning" />
              {t("requests.generate.notApproved", { status: plan.status })}
            </div>
          )}

          {plan.courses.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
              {t("requests.generate.noCourses")}
            </div>
          )}

          {plan.courses.map((c) => {
            const s = specs[c.requestCourseId];
            if (!s) return null;
            return (
              <div key={c.requestCourseId} className="rounded-lg border p-4 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={s.include}
                    onCheckedChange={(v) => setSpec(c.requestCourseId, { include: v === true })}
                    disabled={!plan.canGenerate}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.courseTitle ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.courseCode} · {t("requests.traineeCount")}: {c.traineeCount}
                      {c.alreadyGenerated && ` · ${t("requests.generate.alreadyGenerated")}`}
                    </span>
                  </span>
                </label>

                {s.include && (
                  <>
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        {t("requests.generate.selectTrainer")}
                      </div>
                      {trainersLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("misc.loading")}
                        </div>
                      ) : trainersError ? (
                        <div className="flex items-center gap-2 text-xs text-destructive py-1.5">
                          <AlertCircle className="h-3.5 w-3.5" /> {trainersError}
                        </div>
                      ) : !s.showAllTrainers && (trainersByCourse[c.courseId] ?? []).length === 0 ? (
                        <div className="flex items-center gap-2 text-xs text-warning py-1.5">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {t("requests.generate.noTrainers")}
                        </div>
                      ) : (
                        <Select
                          value={s.trainerId}
                          onValueChange={(v) => {
                            // Check if selected trainer is certified
                            const isCertified = (trainersByCourse[c.courseId] ?? []).some(tr => tr.id === v);
                            setSpec(c.requestCourseId, {
                              trainerId: v,
                              waiveCertification: !isCertified && s.showAllTrainers,
                            });
                          }}
                        >
                          <SelectTrigger className="w-full"><SelectValue placeholder={t("requests.generate.selectTrainerPlaceholder")} /></SelectTrigger>
                          <SelectContent>
                            {/* Certified trainers first */}
                            {(trainersByCourse[c.courseId] ?? []).map((tr) => (
                              <SelectItem key={`cert-${tr.id}`} value={tr.id}>
                                <div className="py-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium">{trainerName(tr, locale)}</span>
                                    <span className="text-xs text-muted-foreground">{tr.refNumber}</span>
                                    {certStatusChip(tr.certStatus)}
                                  </div>
                                  {(tr.qualificationTitle || tr.validUntil) && (
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                      {tr.qualificationTitle && (
                                        <span className="inline-flex items-center gap-1">
                                          <ShieldCheck className="h-3 w-3 text-primary" />
                                          {t("requests.generate.qualification")}: {tr.qualificationTitle}
                                        </span>
                                      )}
                                      {tr.validUntil && (
                                        <span className="inline-flex items-center gap-1">
                                          <CalendarRange className="h-3 w-3" />
                                          {t("requests.generate.validUntil")}: {new Date(tr.validUntil).toLocaleDateString()}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                            {/* If showAllTrainers is on, also show all active trainers */}
                            {s.showAllTrainers && (allTrainers.map((tr) => {
                              const isCertified = (trainersByCourse[c.courseId] ?? []).some(c => c.id === tr.id);
                              if (isCertified) return null; // already shown above
                              return (
                                <SelectItem key={`all-${tr.id}`} value={tr.id}>
                                  {trainerName(tr, locale)} · {tr.refNumber} ⚠️
                                </SelectItem>
                              );
                            }))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Certification waiver warning */}
                      {s.waiveCertification && s.trainerId && (
                        <div className="rounded-md border border-warning/30 bg-warning/10 p-2.5 space-y-2">
                          <div className="flex items-center gap-2 text-xs text-warning font-medium">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {t("requests.generate.waiverWarning") || "This trainer is not certified for this course. This assignment will be recorded as a qualification exception."}
                          </div>
                          <Input
                            placeholder={t("requests.generate.waiverReasonPlaceholder") || "Reason for exception (optional)"}
                            value={s.waiverReason}
                            onChange={(e) => setSpec(c.requestCourseId, { waiverReason: e.target.value })}
                            className="text-xs h-7"
                          />
                        </div>
                      )}

                      {/* Toggle: show all trainers (coordinator-only exception) */}
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={s.showAllTrainers}
                          onCheckedChange={(checked) => setSpec(c.requestCourseId, {
                            showAllTrainers: !!checked,
                            // Reset waiver when toggling off
                            waiveCertification: !checked ? false : s.waiveCertification,
                            trainerId: !checked ? "" : s.trainerId,
                          })}
                        />
                        {t("requests.generate.showAllTrainers") || "Show all trainers (exception)"}
                      </label>
                    </div>

                    <FormGrid cols={3}>
                      <Field label={t("sessions.shift")}>
                        <Select value={s.shift} onValueChange={(v) => setSpec(c.requestCourseId, { shift: v as CourseSpec["shift"] })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MORNING">{t("sessions.shift.MORNING")}</SelectItem>
                            <SelectItem value="EVENING">{t("sessions.shift.EVENING")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={t("sessions.startDate")} required>
                        <Input type="date" value={s.startDate} onChange={(e) => setSpec(c.requestCourseId, { startDate: e.target.value })} />
                      </Field>
                      <Field label={t("sessions.endDate")} required>
                        <Input type="date" value={s.endDate} onChange={(e) => setSpec(c.requestCourseId, { endDate: e.target.value })} />
                      </Field>
                      <Field label={t("sessions.city")}>
                        <Input value={s.city} onChange={(e) => setSpec(c.requestCourseId, { city: e.target.value })} />
                      </Field>
                      <Field label={t("sessions.venue")}>
                        <Input value={s.venue} onChange={(e) => setSpec(c.requestCourseId, { venue: e.target.value })} />
                      </Field>
                      <Field label={t("sessions.capacity")}>
                        <Input
                          type="number"
                          min={1}
                          value={s.capacity}
                          onChange={(e) => setSpec(c.requestCourseId, { capacity: parseInt(e.target.value, 10) || 1 })}
                        />
                      </Field>
                    </FormGrid>

                    <Field label={t("requests.generate.trainerNotes")}>
                      <Textarea
                        rows={2}
                        value={s.notes}
                        onChange={(e) => setSpec(c.requestCourseId, { notes: e.target.value })}
                        placeholder={t("requests.generate.trainerNotesPlaceholder")}
                      />
                    </Field>
                  </>
                )}
              </div>
            );
          })}

          {plan.canGenerate && (
            <p className="text-xs text-muted-foreground">
              {t("requests.generate.hint", { count: selected.length })}
            </p>
          )}
        </div>
      ) : null}
    </FormDialog>
  );
}
