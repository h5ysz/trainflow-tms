"use client";

// Full-screen course display for coordinators: opens the course from the training
// request drawer and mirrors the complete request data — company, request fields,
// every course (with code/ref/duration), sessions, and each trainee with all of
// their fields on large, clearly readable cards that fill the viewport.
//
// Deliberately rendered through createPortal as a plain overlay rather than a Radix
// Dialog: it must sit above the request drawer (which is itself a portal dialog) and
// take over the entire screen, and the native Fullscreen API needs a real DOM node to
// mount on.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { Building2, FileText, Maximize, Minimize, Users, X } from "lucide-react";

export interface FullScreenCourse {
  course: {
    id: string;
    title: string;
    titleAr?: string | null;
    code?: string | null;
    refNumber?: string | null;
    durationHours?: number | null;
  };
  trainees: Array<{
    trainee: {
      refNumber?: string | null;
      fullName: string;
      nationalId: string;
      nationality?: string | null;
      jobTitle?: string | null;
      mobile?: string | null;
      email?: string | null;
      documents?: string | null; // JSON-encoded array of { url, filename, type }
    };
  }>;
}

export interface FullScreenRequestInfo {
  requestRef?: string | null;
  priority?: string | null;
  status?: string | null;
  company?: {
    name?: string | null;
    nameAr?: string | null;
    refNumber?: string | null;
  } | null;
  preferredLocation?: string | null;
  preferredDateFrom?: string | null;
  preferredDateTo?: string | null;
  preferredLanguage?: string | null;
  notes?: string | null;
  documents?: string | null; // JSON-encoded array of { url, filename, type }
  sessions?: Array<{
    id: string;
    refNumber?: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

function parseDocs(raw?: string | null): Array<{ url?: string; filename?: string; type?: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function infoRow(label: string, value?: string | number | null, mono = false) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium break-words ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function fmtDate(value?: string | null, localeStr?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(localeStr);
}

function preferredLanguageLabel(value: string | null | undefined, isAr: boolean): string | null {
  if (!value) return null;
  if (value === "ar") return isAr ? "العربية" : "Arabic";
  if (value === "en") return "English";
  return isAr ? "العربية والإنجليزية" : "Arabic & English"; // bilingual or legacy
}

export function CourseFullScreenView({
  open,
  onClose,
  requestInfo,
  courses,
  initialCourseId,
}: {
  open: boolean;
  onClose: () => void;
  requestInfo?: FullScreenRequestInfo | null;
  courses: FullScreenCourse[];
  initialCourseId?: string | null;
}) {
  const { t, locale } = useI18n();
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";
  const [courseId, setCourseId] = useState<string | null>(null);
  const [isNativeFs, setIsNativeFs] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const info = requestInfo ?? {};

  // When opened, focus the requested course (or the first one).
  useEffect(() => {
    if (open) setCourseId(initialCourseId ?? courses[0]?.course.id ?? null);
  }, [open, initialCourseId, courses]);

  // Close immediately: exit native fullscreen first (if active) so the overlay
  // unmounts right away instead of lingering while the browser exits fullscreen.
  const handleClose = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  };

  // Escape closes the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // Track native fullscreen state so the toggle icon stays accurate.
  useEffect(() => {
    if (!open) return;
    const onChange = () => setIsNativeFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [open]);

  const toggleNativeFullscreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen?.();
      }
    } catch {
      // Fullscreen can be denied; the overlay still works.
    }
  };

  if (!open) return null;

  const course = courses.find((c) => c.course.id === courseId) ?? courses[0];
  const trainees = course?.trainees ?? [];
  const courseTitle = isAr && course?.course.titleAr ? course.course.titleAr : course?.course.title ?? "";
  const companyName =
    isAr && info.company?.nameAr ? info.company.nameAr : (info.company?.name ?? null);
  const companyRef = info.company?.refNumber ?? null;
  const reqDocs = parseDocs(info.documents);
  const sessions = info.sessions ?? [];

  return createPortal(
    <div
      ref={shellRef}
      dir={dir}
      className="pointer-events-auto fixed inset-0 z-[80] flex flex-col overflow-hidden bg-slate-100"
    >
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2 border-b bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleClose}
            title={isAr ? "إغلاق" : "Close"}
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-lg font-bold sm:text-xl" dir="auto">
              {courseTitle || (isAr ? "الدورة التدريبية" : "Training Course")}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {course?.course.code && <span className="font-mono">{course.course.code}</span>}
              {typeof course?.course.durationHours === "number" && (
                <span>
                  {t("courses.durationHours")}: {course.course.durationHours}
                </span>
              )}
              {info.requestRef && <span className="font-mono">{info.requestRef}</span>}
              {companyName && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {companyName}
                </span>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => void toggleNativeFullscreen()}
            title={isAr ? (isNativeFs ? "خروج من ملء الشاشة" : "ملء الشاشة") : isNativeFs ? "Exit fullscreen" : "Fullscreen"}
          >
            {isNativeFs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {isAr ? (isNativeFs ? "خروج من ملء الشاشة" : "ملء الشاشة") : isNativeFs ? "Exit" : "Fullscreen"}
            </span>
          </Button>
        </div>

        {/* Course selector — only when the request spans more than one course */}
        {courses.length > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {courses.map((c) => (
              <button
                key={c.course.id}
                onClick={() => setCourseId(c.course.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  c.course.id === (course?.course.id ?? courses[0].course.id)
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {(isAr && c.course.titleAr) ? c.course.titleAr : c.course.title}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Course + request + sessions panels */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Course info */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="mb-1.5 flex items-center gap-2 text-xs font-bold">
              {t("requests.course")}
              <span className="text-[11px] font-normal text-muted-foreground">
                ({t("requests.traineeCount")}: {trainees.length})
              </span>
            </h3>
            <div className="divide-y">
              {course?.course.title && (
                <div className="py-1">
                  <div className="text-[11px] text-muted-foreground">{isAr ? "اسم الدورة (إنجليزي)" : "Course title (EN)"}</div>
                  <div className="text-sm font-semibold break-words" dir="auto">{course.course.title}</div>
                </div>
              )}
              {course?.course.titleAr && (
                <div className="py-1">
                  <div className="text-[11px] text-muted-foreground">{isAr ? "اسم الدورة (عربي)" : "Course title (AR)"}</div>
                  <div className="text-sm font-semibold break-words" dir="auto">{course.course.titleAr}</div>
                </div>
              )}
              {infoRow(isAr ? "الكود" : "Code", course?.course.code, true)}
              {infoRow(isAr ? "الرقم المرجعي" : "Reference", course?.course.refNumber, true)}
              {typeof course?.course.durationHours === "number" &&
                infoRow(t("courses.durationHours"), `${course.course.durationHours}`)}
              {infoRow(t("requests.traineeCount"), String(trainees.length))}
            </div>
          </div>

          {/* Request info */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="mb-1.5 text-xs font-bold">{isAr ? "بيانات الطلب" : "Request Details"}</h3>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {info.status && <StatusBadge status={info.status} />}
              {info.priority && <PriorityBadge priority={info.priority} />}
            </div>
            <div className="divide-y">
              {infoRow(isAr ? "رقم الطلب" : "Request No.", info.requestRef, true)}
              {info.company && (
                <div className="py-1">
                  <div className="text-[11px] text-muted-foreground">{t("requests.company")}</div>
                  <div className="text-sm font-medium break-words" dir="auto">
                    {companyName ?? "—"}
                    {companyRef ? <span className="ms-2 font-mono text-xs text-muted-foreground">{companyRef}</span> : null}
                  </div>
                </div>
              )}
              {infoRow(t("requests.preferredLocation"), info.preferredLocation)}
              {infoRow(t("requests.preferredDateFrom"), fmtDate(info.preferredDateFrom, locale))}
              {infoRow(t("requests.preferredDateTo"), fmtDate(info.preferredDateTo, locale))}
              {infoRow(t("requests.preferredLanguage"), preferredLanguageLabel(info.preferredLanguage, isAr))}
              {info.notes && (
                <div className="py-1">
                  <div className="text-[11px] text-muted-foreground">{t("requests.notes")}</div>
                  <div className="text-sm whitespace-pre-wrap break-words">{info.notes}</div>
                </div>
              )}
            </div>

            {/* Request-level attachments */}
            {reqDocs.length > 0 && (
              <div className="mt-2 border-t pt-1.5">
                <div className="mb-1 text-[11px] text-muted-foreground">
                  {t("requests.attachments")} ({reqDocs.length})
                </div>
                <div className="space-y-1">
                  {reqDocs.map((d, i) => (
                    <a
                      key={i}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[11px] text-info hover:underline"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{d.filename ?? d.url ?? `${t("requests.attachments")} ${i + 1}`}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sessions */}
          {sessions.length > 0 ? (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="mb-1.5 text-xs font-bold">{t("sessions.title")}</h3>
              <div className="space-y-1.5">
                {sessions.map((s) => (
                  <div key={s.id} className="rounded-lg border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{s.title}</span>
                      {s.status && <StatusBadge status={s.status} />}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {s.refNumber && <span className="font-mono">{s.refNumber}</span>}
                      {s.startDate && <span>{fmtDate(s.startDate, locale)}</span>}
                      {s.endDate && <span>→ {fmtDate(s.endDate, locale)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="text-xs font-bold">{t("sessions.title")}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{isAr ? "لا توجد جلسات مرتبطة بعد" : "No sessions linked yet"}</p>
            </div>
          )}
        </div>

        {/* Trainee cards */}
        <h3 className="mt-5 mb-2.5 flex items-center gap-2 text-sm font-bold">
          <Users className="h-4 w-4 text-primary" />
          {t("requests.trainees") || "Trainees"}
          <span className="text-xs font-normal text-muted-foreground">({trainees.length})</span>
        </h3>

        {trainees.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Users className="h-14 w-14 opacity-40" />
            <p className="text-lg">{isAr ? "لا يوجد متدربون لهذه الدورة" : "No trainees for this course"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {trainees.map(({ trainee }, idx) => {
              const traineeDocs = parseDocs(trainee.documents);
              return (
                <div
                  key={`${course?.course.id}-${idx}`}
                  className="flex flex-col rounded-xl border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {initials(trainee.fullName)}
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {isAr ? `متدرب #${idx + 1}` : `Trainee #${idx + 1}`}
                    </span>
                  </div>

                  <div className="mt-3 min-w-0">
                    <div className="break-words text-lg font-bold leading-tight sm:text-xl" dir="auto">
                      {trainee.fullName}
                    </div>
                    {trainee.refNumber && (
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{trainee.refNumber}</div>
                    )}
                    <div className="mt-1 font-mono text-sm text-muted-foreground" dir="ltr">
                      {trainee.nationalId}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
                    {trainee.nationality && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                        {trainee.nationality}
                      </span>
                    )}
                    {trainee.jobTitle && (
                      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                        <span className="truncate">{trainee.jobTitle}</span>
                      </span>
                    )}
                    {trainee.mobile && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground" dir="ltr">
                        {trainee.mobile}
                      </span>
                    )}
                    {trainee.email && (
                      <span className="inline-flex max-w-full items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground" dir="ltr">
                        <span className="truncate">{trainee.email}</span>
                      </span>
                    )}
                  </div>

                  {traineeDocs.length > 0 && (
                    <div className="mt-3 border-t pt-2">
                      <div className="mb-1 text-[11px] text-muted-foreground">
                        {t("requests.attachments")} ({traineeDocs.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {traineeDocs.map((d, di) => (
                          <a
                            key={di}
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-info hover:bg-info/5"
                            title={d.filename ?? d.url}
                          >
                            <FileText className="h-3 w-3" />
                            {d.type ?? "doc"} {di + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
