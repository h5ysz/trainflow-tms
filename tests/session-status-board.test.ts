// Pure helpers behind the full-screen "session status board" shown on training
// request course displays (used by both the API grouping and the React board).
import { describe, it, expect } from "vitest";
import {
  groupEnrollmentsBySession,
  finalTestMeta,
  attendanceIsAwaitingCheckIn,
  countBoardStatuses,
  type SessionStatusEnrollment,
} from "@/lib/sessions/session-status-board";

const trainee = (id: string, fullName: string) => ({ id, fullName, nationalId: "102" + id });

const enrollment = (id: string, sessionId: string, overrides: Partial<SessionStatusEnrollment> = {}): SessionStatusEnrollment => ({
  id,
  sessionId,
  attendanceStatus: "NOT_STARTED",
  finalTestStatus: "PENDING",
  enrollmentStatus: "PENDING",
  trainee: trainee(id, `Trainee ${id}`),
  ...overrides,
});

describe("groupEnrollmentsBySession", () => {
  it("attaches each session's enrollments in order", () => {
    const sessions = [{ id: "s1", title: "Session 1" }, { id: "s2", title: "Session 2" }];
    const rows = [
      enrollment("e1", "s1", { attendanceStatus: "PRESENT" }),
      enrollment("e2", "s1", { finalTestStatus: "PASSED" }),
      enrollment("e3", "s2"),
    ];
    const grouped = groupEnrollmentsBySession(sessions, rows);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ id: "s1", title: "Session 1" });
    expect(grouped[0].enrollments.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(grouped[1].enrollments.map((e) => e.id)).toEqual(["e3"]);
  });

  it("drops the sessionId key from each enrollment (implied by its session)", () => {
    const grouped = groupEnrollmentsBySession(
      [{ id: "s1" }],
      [enrollment("e1", "s1")],
    );
    expect(grouped[0].enrollments[0]).not.toHaveProperty("sessionId");
    expect(grouped[0].enrollments[0].id).toBe("e1");
  });

  it("gives sessions without enrollments an empty array", () => {
    const grouped = groupEnrollmentsBySession(
      [{ id: "s1" }, { id: "s2" }],
      [enrollment("e1", "s1")],
    );
    expect(grouped[1].enrollments).toEqual([]);
  });

  it("ignores enrollments without a sessionId and unknown session ids", () => {
    const grouped = groupEnrollmentsBySession(
      [{ id: "s1" }],
      [
        enrollment("e1", "s1"),
        { ...enrollment("e2", "ghost"), sessionId: null },
        enrollment("e3", "other-session"),
      ],
    );
    expect(grouped[0].enrollments.map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("finalTestMeta", () => {
  it("maps PASSED / FAILED to their label pairs", () => {
    expect(finalTestMeta("PASSED")).toMatchObject({ label: "Passed", labelAr: "ناجح" });
    expect(finalTestMeta("FAILED")).toMatchObject({ label: "Failed", labelAr: "راسب" });
    expect(finalTestMeta("NOT_REQUIRED")).toMatchObject({ labelAr: "غير مطلوب" });
    expect(finalTestMeta("PENDING")).toMatchObject({ labelAr: "قيد الانتظار" });
    expect(finalTestMeta("IN_PROGRESS")).toMatchObject({ labelAr: "قيد التنفيذ" });
  });

  it("returns null for unknown or missing statuses", () => {
    expect(finalTestMeta(null)).toBeNull();
    expect(finalTestMeta(undefined)).toBeNull();
    expect(finalTestMeta("SOMETHING_ELSE")).toBeNull();
  });
});

describe("attendanceIsAwaitingCheckIn", () => {
  it("is true when the trainee has not been marked yet", () => {
    expect(attendanceIsAwaitingCheckIn(null)).toBe(true);
    expect(attendanceIsAwaitingCheckIn(undefined)).toBe(true);
    expect(attendanceIsAwaitingCheckIn("NOT_STARTED")).toBe(true);
  });

  it("is false once a status has been recorded", () => {
    expect(attendanceIsAwaitingCheckIn("PRESENT")).toBe(false);
    expect(attendanceIsAwaitingCheckIn("LATE")).toBe(false);
    expect(attendanceIsAwaitingCheckIn("ABSENT")).toBe(false);
  });
});

describe("countBoardStatuses", () => {
  it("counts attendance and final-test results separately", () => {
    const counts = countBoardStatuses([
      enrollment("e1", "s1", { attendanceStatus: "PRESENT", finalTestStatus: "PASSED" }),
      enrollment("e2", "s1", { attendanceStatus: "PRESENT", finalTestStatus: "FAILED" }),
      enrollment("e3", "s1", { attendanceStatus: "LATE", finalTestStatus: "PASSED" }),
      enrollment("e4", "s1", { attendanceStatus: "ABSENT", finalTestStatus: "PENDING" }),
      enrollment("e5", "s1", { attendanceStatus: "NOT_STARTED" }),
    ]);
    expect(counts).toEqual({ present: 2, late: 1, absent: 1, passed: 2, failed: 1 });
  });

  it("starts at zero", () => {
    expect(countBoardStatuses([])).toEqual({ present: 0, late: 0, absent: 0, passed: 0, failed: 0 });
  });
});
