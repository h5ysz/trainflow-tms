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
  refNumber: string;
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
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
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
  const { t } = useI18n();
  const { toast } = useToast();
  const [plan, setPlan] = useState<GeneratePlan | null>(null);
  const [specs, setSpecs] = useState<Record<string, CourseSpec>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Authorized trainers per courseId, loaded from /trainer-certifications.
  const [trainersByCourse, setTrainersByCourse] = useState<Record<string, TrainerOption[]>>({});
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [trainersError, setTrainersError] = useState<string | null>(null);
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
      const results = await Promise.all(
        courses.map(async (c) => {
          const res = await api.getList<TrainerOption>("/trainer-certifications", {
            courseId: c.courseId,
            status: "VALID",
            pageSize: 200,
          });
          return [c.courseId, res.rows] as const;
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
                      ) : (trainersByCourse[c.courseId] ?? []).length === 0 ? (
                        <div className="flex items-center gap-2 text-xs text-warning py-1.5">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {t("requests.generate.noTrainers")}
                        </div>
                      ) : (
                        <Select
                          value={s.trainerId}
                          onValueChange={(v) => setSpec(c.requestCourseId, { trainerId: v })}
                        >
                          <SelectTrigger className="w-full"><SelectValue placeholder={t("requests.generate.selectTrainerPlaceholder")} /></SelectTrigger>
                          <SelectContent>
                            {(trainersByCourse[c.courseId] ?? []).map((tr) => (
                              <SelectItem key={tr.id} value={tr.id}>
                                {tr.fullName} · {tr.refNumber}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
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
