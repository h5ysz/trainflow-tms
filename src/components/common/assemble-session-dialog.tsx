"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Assemble Session Dialog
// ─────────────────────────────────────────────────────────────────────────────
// The primary multi-contractor workflow. Lets the coordinator pick trainees
// from any number of APPROVED requests (for the same course) and assemble
// them into a single new session.
//
// Flow:
//   1. Select a course → loads all approved requests for that course
//   2. Pick trainees from those requests (grouped by request → company)
//   3. Configure the session (title, shift, dates, capacity, trainer optional)
//   4. Submit → POST /api/sessions/assemble
//
// Per the approved design, the assembled session is INDEPENDENT of any
// request — requestId and requestCourseId are null. Each trainee's companyId
// is snapshotted at enrollment time so the contractor linkage is preserved.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { Users, AlertCircle, Loader2, Search, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { trainerName } from "@/lib/i18n/trainer-name";

interface CourseOption { id: string; title: string; code: string; }
interface TrainerOption { id: string; nameEn: string; nameAr?: string | null; }

interface ApprovedRequestTrainee {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  company: { id: string; name: string } | null;
}

interface ApprovedRequestCourse {
  requestCourseId: string;
  requestRef: string;
  requestStatus: string;
  courseTitle: string;
  courseCode: string;
  trainees: ApprovedRequestTrainee[];
}

interface AssembleResponse {
  session: {
    id: string;
    refNumber: string;
    title: string;
    startDate: string;
    endDate: string;
    capacity: number;
    expectedTrainees: number;
    trainerId: string | null;
  };
  enrolledCount: number;
  sourceRequestRefs: string[];
  companyBreakdown: Record<string, number>;
}

export function AssembleSessionDialog({
  open,
  onOpenChange,
  onAssembled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful assembly. The parent typically navigates to
   *  the new session's detail page. */
  onAssembled: (session: AssembleResponse["session"]) => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();

  // ── State ────────────────────────────────────────────────────────────────
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [approvedCourses, setApprovedCourses] = useState<ApprovedRequestCourse[]>([]);
  const [approvedError, setApprovedError] = useState<string | null>(null);
  const [loadedCourseFor, setLoadedCourseFor] = useState<string | null>(null);
  const [selectedTraineeIds, setSelectedTraineeIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Session config
  const [title, setTitle] = useState("");
  const [shift, setShift] = useState<"MORNING" | "EVENING">("MORNING");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacity, setCapacity] = useState<number>(20);
  const [trainerId, setTrainerId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // ── Load courses + trainers when opened ──────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (courses.length === 0) {
      api.getList<CourseOption>("/courses", { pageSize: 200 })
        .then((r) => setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code }))))
        .catch(() => {});
    }
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 200 })
        .then((r) => setTrainers(r.rows.map((tr) => ({ id: tr.id, nameEn: tr.nameEn, nameAr: tr.nameAr }))))
        .catch(() => {});
    }
  }, [open, courses.length, trainers.length]);

  // ── Load approved requests for the selected course ───────────────────────
  // When the course changes, query all APPROVED requests and pull their
  // requestCourses (filtered to this course) with their trainee rosters.
  // Loading + error are derived from `loadedCourseFor` to avoid calling
  // setState synchronously in the effect body (React 19 set-state-in-effect).
  const loadingApproved = open && Boolean(selectedCourseId) && loadedCourseFor !== selectedCourseId;
  useEffect(() => {
    if (!open || !selectedCourseId || loadedCourseFor === selectedCourseId) return;
    let cancelled = false;
    // Defer the fetch to a microtask so setState calls inside the promise
    // resolution don't fire during the effect's synchronous body.
    const handle = setTimeout(() => {
      if (cancelled) return;
      api.getList<{ id: string; refNumber: string; status: string }>(
        "/requests",
        { pageSize: 100, status: "APPROVED" }
      )
        .then(async (listRes) => {
          if (cancelled) return;
          const details = await Promise.all(
            listRes.rows.map((r) =>
              api.get<{
                id: string;
                refNumber: string;
                status: string;
                requestCourses: Array<{
                  id: string;
                  courseId: string;
                  course: { id: string; title: string; code: string };
                  trainees: Array<{ trainee: ApprovedRequestTrainee }>;
                }>;
              }>(`/requests/${r.id}`)
            )
          );
          if (cancelled) return;
          // Filter to requestCourses matching the selected course, and flatten.
          const matching: ApprovedRequestCourse[] = [];
          for (const d of details) {
            for (const rc of d.requestCourses) {
              if (rc.courseId !== selectedCourseId) continue;
              matching.push({
                requestCourseId: rc.id,
                requestRef: d.refNumber,
                requestStatus: d.status,
                courseTitle: rc.course.title,
                courseCode: rc.course.code,
                trainees: rc.trainees.map((t) => t.trainee),
              });
            }
          }
          setApprovedCourses(matching);
          setApprovedError(null);
          setLoadedCourseFor(selectedCourseId);
        })
        .catch((e) => {
          if (cancelled) return;
          setApprovedError((e as Error).message);
          setLoadedCourseFor(selectedCourseId);
        });
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, selectedCourseId, loadedCourseFor]);

  // ── Reset state when dialog closes ───────────────────────────────────────
  useEffect(() => {
    if (open) return;
    // Defer cleanup so the close animation isn't disrupted.
    const handle = setTimeout(() => {
      setSelectedCourseId("");
      setApprovedCourses([]);
      setLoadedCourseFor(null);
      setSelectedTraineeIds(new Set());
      setSearch("");
      setTitle("");
      setShift("MORNING");
      setStartDate("");
      setEndDate("");
      setCapacity(20);
      setTrainerId("");
    }, 0);
    return () => clearTimeout(handle);
  }, [open]);

  // ── Derived: all trainees across all approved requestCourses (for counting) ──
  const allTrainees = useMemo(() => {
    return approvedCourses.flatMap((arc) =>
      arc.trainees.map((tr) => ({
        ...tr,
        requestRef: arc.requestRef,
        requestCourseId: arc.requestCourseId,
      }))
    );
  }, [approvedCourses]);

  const selectedCount = selectedTraineeIds.size;
  const selectedRequestRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const tr of allTrainees) {
      if (selectedTraineeIds.has(tr.id)) refs.add(tr.requestRef);
    }
    return Array.from(refs);
  }, [allTrainees, selectedTraineeIds]);

  const filteredTrainees = useMemo(() => {
    if (!search.trim()) return allTrainees;
    const q = search.toLowerCase();
    return allTrainees.filter((tr) =>
      tr.fullName.toLowerCase().includes(q) ||
      tr.nationalId.toLowerCase().includes(q) ||
      tr.refNumber.toLowerCase().includes(q) ||
      (tr.company?.name ?? "").toLowerCase().includes(q)
    );
  }, [allTrainees, search]);

  // ── Toggle trainee selection ─────────────────────────────────────────────
  const toggleTrainee = (id: string) => {
    setSelectedTraineeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTraineeIds.size === allTrainees.length) {
      setSelectedTraineeIds(new Set());
    } else {
      setSelectedTraineeIds(new Set(allTrainees.map((tr) => tr.id)));
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedCourseId) {
      toast({ title: t("misc.error"), description: t("session.assembleSelectCourse"), variant: "destructive" });
      return;
    }
    if (selectedTraineeIds.size === 0) {
      toast({ title: t("misc.error"), description: t("session.assembleSelected", { count: 0, requests: 0 }), variant: "destructive" });
      return;
    }
    if (!title.trim() || !startDate || !endDate) {
      toast({ title: t("misc.error"), description: "Title, start date, and end date are required", variant: "destructive" });
      return;
    }

    // Build the trainees payload — each selected trainee needs their
    // sourceRequestCourseId for provenance.
    const traineeSpecs: Array<{ traineeId: string; sourceRequestCourseId: string }> = [];
    for (const tr of allTrainees) {
      if (selectedTraineeIds.has(tr.id)) {
        traineeSpecs.push({ traineeId: tr.id, sourceRequestCourseId: tr.requestCourseId });
      }
    }

    setSubmitting(true);
    try {
      const res = await api.post<AssembleResponse>("/sessions/assemble", {
        courseId: selectedCourseId,
        title: title.trim(),
        shift,
        startDate,
        endDate,
        capacity,
        trainerId: trainerId || null,
        trainees: traineeSpecs,
      });
      toast({
        title: t("misc.success"),
        description: t("session.assembleSuccess", {
          ref: res.session.refNumber,
          enrolled: res.enrolledCount,
          requests: res.sourceRequestRefs.length,
        }),
      });
      onOpenChange(false);
      onAssembled(res.session);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("session.assembleTitle")}
      description={t("session.assembleHint")}
      icon={Layers}
      size="lg"
      onSubmit={handleSubmit}
      isSubmitting={submitting}
    >
      <div className="space-y-6">
        {/* Step 1: Course selection */}
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">1</span>
            {t("session.assembleStepCourse")}
          </h3>
          <Field label={t("requests.course")} required>
            <Select value={selectedCourseId} onValueChange={(v) => { setSelectedCourseId(v); setSelectedTraineeIds(new Set()); }}>
              <SelectTrigger><SelectValue placeholder={t("session.assembleSelectCourse")} /></SelectTrigger>
              <SelectContent>
                {courses.length === 0 ? (
                  <SelectItem value="_none" disabled>{t("session.assembleNoCourses")}</SelectItem>
                ) : (
                  courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* Step 2: Trainee picker (only shown after a course is selected) */}
        {selectedCourseId && (
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">2</span>
              {t("session.assembleStepTrainees")}
            </h3>

            {loadingApproved ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : approvedError ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> {approvedError}
              </div>
            ) : allTrainees.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("session.assembleNoApprovedRequests")}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Summary + search + select-all */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-muted-foreground">
                    {t("session.assembleSelected", {
                      count: selectedCount,
                      requests: selectedRequestRefs.length,
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("session.manualAddSearch")}
                        className="h-8 ps-8 w-64"
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={toggleAll} type="button">
                      {selectedTraineeIds.size === allTrainees.length ? "Clear all" : "Select all"}
                    </Button>
                  </div>
                </div>

                {/* Trainee list grouped by request */}
                <div className="rounded-md border max-h-[40vh] overflow-y-auto">
                  {approvedCourses.map((arc) => {
                    const arcFilteredTrainees = filteredTrainees.filter((tr) => tr.requestRef === arc.requestRef);
                    if (arcFilteredTrainees.length === 0) return null;
                    return (
                      <div key={arc.requestCourseId} className="border-b last:border-b-0">
                        <div className="px-3 py-2 bg-muted/30 text-xs font-semibold sticky top-0">
                          {t("session.assembleTraineesFrom", {
                            request: arc.requestRef,
                            company: arc.trainees[0]?.company?.name ?? "—",
                          })}
                          <span className="ms-2 text-muted-foreground font-normal">
                            ({arcFilteredTrainees.length} trainee{arcFilteredTrainees.length !== 1 ? "s" : ""})
                          </span>
                        </div>
                        <table className="w-full text-xs">
                          <tbody>
                            {arcFilteredTrainees.map((tr) => (
                              <tr key={tr.id} className="border-t hover:bg-muted/20 cursor-pointer"
                                onClick={() => toggleTrainee(tr.id)}>
                                <td className="px-2 py-1.5 w-8">
                                  <Checkbox checked={selectedTraineeIds.has(tr.id)} />
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="font-medium">{tr.fullName}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">{tr.refNumber}</div>
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">{tr.nationalId}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">{tr.jobTitle ?? "—"}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">{tr.company?.name ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Session configuration (only shown after trainees are selected) */}
        {selectedCount > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">3</span>
              {t("session.assembleStepConfig")}
            </h3>
            <FormGrid cols={2}>
              <Field label={t("session.assembleSessionTitle")} required>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("session.assembleSessionTitlePlaceholder")}
                />
              </Field>
              <Field label={t("sessions.shift")}>
                <Select value={shift} onValueChange={(v) => setShift(v as "MORNING" | "EVENING")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MORNING">{t("sessions.shift.MORNING")}</SelectItem>
                    <SelectItem value="EVENING">{t("sessions.shift.EVENING")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("sessions.startDate")} required>
                <Input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label={t("sessions.endDate")} required>
                <Input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
              <Field label={t("session.assembleCapacity")}>
                <Input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 20)}
                />
              </Field>
              <Field label={t("session.assembleTrainerOptional")}>
                <Select value={trainerId || "__none__"} onValueChange={(v) => setTrainerId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("session.assembleNoTrainer")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("session.assembleNoTrainer")}</SelectItem>
                    {trainers.map((tr) => (
                      <SelectItem key={tr.id} value={tr.id}>{trainerName(tr, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>

            {/* Capacity advisory — non-blocking */}
            {selectedCount > capacity && (
              <div className="mt-3 rounded-md border border-info/40 bg-info/10 p-2.5 text-xs flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
                <div>
                  {selectedCount} trainee(s) / {capacity} capacity — the session will be over capacity. You can split it after creation.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
