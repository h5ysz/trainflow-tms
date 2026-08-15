// Pure helpers for the full-screen "session status board" shown on the training
// request course display. The board lets a coordinator — or a contractor
// (المقاول) tracking their own workers — see every session of a request with
// each trainee's live attendance and final-test result on the big screen.
//
// Kept framework-free so the grouping and status-mapping logic is unit-testable
// without React or a database.

export interface SessionStatusTrainee {
  id: string;
  refNumber?: string | null;
  fullName: string;
  nationalId?: string | null;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
}

export interface SessionStatusCompany {
  id: string;
  name?: string | null;
  refNumber?: string | null;
}

/** A raw enrollment row as returned by the API, keyed by `sessionId`. */
export interface SessionStatusEnrollment {
  id: string;
  sessionId?: string | null;
  attendanceStatus?: string | null;
  finalTestStatus?: string | null;
  enrollmentStatus?: string | null;
  trainee: SessionStatusTrainee;
  company?: SessionStatusCompany | null;
}

/** An enrollment shown on a session card (the session it belongs to is implied). */
export interface SessionBoardEnrollment {
  id: string;
  attendanceStatus?: string | null;
  finalTestStatus?: string | null;
  enrollmentStatus?: string | null;
  trainee: SessionStatusTrainee;
  company?: SessionStatusCompany | null;
}

export interface SessionBoardSession {
  id: string;
  refNumber?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  shift?: string | null;
  status?: string | null;
}

export interface SessionBoard extends SessionBoardSession {
  enrollments: SessionBoardEnrollment[];
}

/**
 * Attach each session's enrollments, dropping the `sessionId` key (it becomes
 * implied by the containing session). Sessions without enrollments get [].
 */
export function groupEnrollmentsBySession<S extends { id: string }>(
  sessions: S[],
  enrollments: SessionStatusEnrollment[],
): Array<S & { enrollments: SessionBoardEnrollment[] }> {
  const bySession = new Map<string, SessionBoardEnrollment[]>();
  for (const e of enrollments) {
    if (!e.sessionId) continue;
    const arr = bySession.get(e.sessionId) ?? [];
    arr.push({
      id: e.id,
      attendanceStatus: e.attendanceStatus,
      finalTestStatus: e.finalTestStatus,
      enrollmentStatus: e.enrollmentStatus,
      trainee: e.trainee,
      company: e.company,
    });
    bySession.set(e.sessionId, arr);
  }
  return sessions.map((s) => ({ ...s, enrollments: bySession.get(s.id) ?? [] }));
}

export interface StatusMeta {
  label: string;
  labelAr: string;
  className: string;
}

// Final-test statuses don't share the generic status colors, so they get their
// own badge meta: green pass / red fail / neutral not-required / amber pending.
export const FINAL_TEST_META: Record<string, StatusMeta> = {
  PASSED: {
    label: "Passed",
    labelAr: "ناجح",
    className: "bg-green-100 text-green-800 border-green-200",
  },
  FAILED: {
    label: "Failed",
    labelAr: "راسب",
    className: "bg-red-100 text-red-800 border-red-200",
  },
  NOT_REQUIRED: {
    label: "Not required",
    labelAr: "غير مطلوب",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  PENDING: {
    label: "Pending",
    labelAr: "قيد الانتظار",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  IN_PROGRESS: {
    label: "In progress",
    labelAr: "قيد التنفيذ",
    className: "bg-info/10 text-info border-info/20",
  },
};

export function finalTestMeta(status?: string | null): StatusMeta | null {
  if (!status) return null;
  return FINAL_TEST_META[status] ?? null;
}

// A trainee who has not been checked in yet is NOT_STARTED. Rather than the
// generic "Not started" label the board says "Awaiting check-in".
export function attendanceIsAwaitingCheckIn(status?: string | null): boolean {
  return !status || status === "NOT_STARTED";
}

export interface BoardCounts {
  present: number;
  late: number;
  absent: number;
  passed: number;
  failed: number;
}

export function countBoardStatuses(rows: SessionBoardEnrollment[]): BoardCounts {
  const counts: BoardCounts = { present: 0, late: 0, absent: 0, passed: 0, failed: 0 };
  for (const r of rows) {
    if (r.attendanceStatus === "PRESENT") counts.present++;
    else if (r.attendanceStatus === "LATE") counts.late++;
    else if (r.attendanceStatus === "ABSENT") counts.absent++;
    if (r.finalTestStatus === "PASSED") counts.passed++;
    else if (r.finalTestStatus === "FAILED") counts.failed++;
  }
  return counts;
}
