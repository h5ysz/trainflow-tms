// GCCLAB AI Copilot — Phase 2 — EXAMS actions
// =====================================================================
// register_scores / correct_scores / register_re_exam / calculate_results
//
// These actions write to TestResult and ExamAttempt. They do NOT modify
// the frozen Training Module's exam engine — they record scores on behalf
// of an authorized user (trainer or coordinator).
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

// ─── EXAM_REGISTER_SCORES ─────────────────────────────────────────────────
interface ScoreEntry {
  traineeId?: string;
  traineeName: string;
  traineeEmail?: string;
  traineeIdNational?: string;
  companyId?: string;
  scorePercent: number;
  testType?: "PRE_TEST" | "FINAL_TEST";
}
interface RegisterScoresInput {
  sessionId: string;
  scores: ScoreEntry[];
  testType?: "PRE_TEST" | "FINAL_TEST";
}
const registerScores: ActionHandler<RegisterScoresInput> = {
  type: "EXAM_REGISTER_SCORES",
  category: "EXAMS",
  description: "Register exam scores for one or more trainees in a session (PRE_TEST or FINAL_TEST).",
  descriptionAr: "تسجيل درجات الامتحان لمتدرب أو أكثر في جلسة (قبلي أو نهائي).",
  resolvePermission: (role) => {
    if (role === "TRAINER" || role === "COORDINATOR" || role === "SUPER_ADMIN") {
      return { module: "final-test", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, user) {
    if (!input.sessionId || !input.scores || input.scores.length === 0) {
      throw new ActionError("sessionId and scores[] are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { course: { select: { id: true, title: true, passScore: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (user.role === "TRAINER" && session.trainerId !== user.trainerId) {
      throw new ActionError("Trainers can only register scores for their own sessions", 403, "FORBIDDEN");
    }
    const testType = input.testType ?? "FINAL_TEST";
    const passScore = session.course.passScore;
    // Validate scores
    for (const s of input.scores) {
      if (s.scorePercent < 0 || s.scorePercent > 100) {
        throw new ActionError(`Invalid score ${s.scorePercent} for ${s.traineeName} (must be 0-100)`, 422, "VALIDATION_ERROR");
      }
    }
    return {
      actionType: "EXAM_REGISTER_SCORES",
      title: "Register Scores",
      titleAr: "تسجيل الدرجات",
      summary: `Register ${input.scores.length} ${testType} score(s) for session ${session.refNumber} (pass=${passScore}%).`,
      summaryAr: `تسجيل ${input.scores.length} درجة ${testType === "PRE_TEST" ? "قبلية" : "نهائية"} للجلسة ${session.refNumber} (نجاح=${passScore}%).`,
      affectedRecords: input.scores.slice(0, 10).map((s) => ({
        entity: "EXAM", description: `${s.traineeName}: ${s.scorePercent}% ${s.scorePercent >= passScore ? "(PASS)" : "(FAIL)"}`,
      })),
      changes: input.scores.slice(0, 20).map((s) => ({
        field: "score", label: s.traineeName,
        oldValue: null, newValue: `${s.scorePercent}% (${s.scorePercent >= passScore ? "PASS" : "FAIL"})`,
      })),
      warnings: [],
      expectedResult: `${input.scores.length} test result(s) will be created.`,
      expectedResultAr: `سيتم إنشاء ${input.scores.length} نتيجة اختبار.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        courseId: session.courseId, courseTitle: session.course.title,
        passScore, testType,
        scores: input.scores,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const scores = p.scores as ScoreEntry[];
    const passScore = p.passScore as number;
    const testType = p.testType as "PRE_TEST" | "FINAL_TEST";
    const created: { id: string; refNumber: string; traineeName: string; scorePercent: number; passed: boolean }[] = [];
    await db.$transaction(async (tx) => {
      for (const s of scores) {
        const refNumber = await nextRefNumber("EXAM", tx);
        const passed = s.scorePercent >= passScore;
        const r = await tx.testResult.create({
          data: {
            refNumber,
            sessionId: p.sessionId as string,
            testType,
            traineeName: s.traineeName,
            traineeEmail: s.traineeEmail ?? null,
            traineeIdNational: s.traineeIdNational ?? null,
            companyId: s.companyId ?? null,
            scorePercent: s.scorePercent,
            passed,
            attemptedAt: new Date(),
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        created.push({ id: r.id, refNumber: r.refNumber, traineeName: r.traineeName, scorePercent: r.scorePercent, passed: r.passed });
      }
    });
    await copilotAudit({
      user,
      action: "EXAM_SUBMIT",
      entity: "EXAM",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI registered ${created.length} ${testType} scores in ${p.sessionRef}`,
      descriptionAr: `سجّل الذكاء الاصطناعي ${created.length} درجة ${testType === "PRE_TEST" ? "قبلية" : "نهائية"} في ${p.sessionRef}`,
      req,
      newValue: { count: created.length, testType, passCount: created.filter((c) => c.passed).length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "EXAM_REGISTER_SCORES",
      message: `${created.length} score(s) registered. ${created.filter((c) => c.passed).length} passed, ${created.filter((c) => !c.passed).length} failed.`,
      messageAr: `تم تسجيل ${created.length} درجة. ${created.filter((c) => c.passed).length} ناجح، ${created.filter((c) => !c.passed).length} راسب.`,
      results: created.map((c) => ({ entity: "EXAM", id: c.id, refNumber: c.refNumber, description: `${c.traineeName}: ${c.scorePercent}% ${c.passed ? "PASS" : "FAIL"}` })),
    };
  },
};

// ─── EXAM_CORRECT_SCORES ──────────────────────────────────────────────────
interface CorrectScoreInput {
  testResultId: string;
  newScore: number;
  reason?: string;
}
const correctScore: ActionHandler<CorrectScoreInput> = {
  type: "EXAM_CORRECT_SCORES",
  category: "EXAMS",
  description: "Correct a single test result's score (re-evaluates pass/fail against course passScore).",
  descriptionAr: "تصحيح درجة نتيجة اختبار واحدة (إعادة تقييم نجاح/رسوب حسب درجة نجاح الدورة).",
  resolvePermission: (role) => {
    if (role === "TRAINER" || role === "COORDINATOR" || role === "SUPER_ADMIN") {
      return { module: "final-test", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.testResultId || input.newScore === undefined) {
      throw new ActionError("testResultId and newScore are required", 422, "VALIDATION_ERROR");
    }
    if (input.newScore < 0 || input.newScore > 100) {
      throw new ActionError("newScore must be 0-100", 422, "VALIDATION_ERROR");
    }
    const result = await db.testResult.findFirst({
      where: { id: input.testResultId, deletedAt: null },
      include: { session: { select: { id: true, refNumber: true, course: { select: { passScore: true } } } } },
    });
    if (!result) throw new ActionError("Test result not found", 404, "NOT_FOUND");
    const passScore = result.session.course.passScore;
    const newPassed = input.newScore >= passScore;
    return {
      actionType: "EXAM_CORRECT_SCORES",
      title: "Correct Score",
      titleAr: "تصحيح الدرجة",
      summary: `Correct ${result.traineeName}'s score from ${result.scorePercent}% → ${input.newScore}% (${result.passed ? "PASS" : "FAIL"} → ${newPassed ? "PASS" : "FAIL"}).`,
      summaryAr: `تصحيح درجة ${result.traineeName} من ${result.scorePercent}% → ${input.newScore}% (${result.passed ? "ناجح" : "راسب"} → ${newPassed ? "ناجح" : "راسب"}).`,
      affectedRecords: [
        { entity: "EXAM", refNumber: result.refNumber, description: result.traineeName },
      ],
      changes: [
        { field: "scorePercent", label: "Score", oldValue: `${result.scorePercent}%`, newValue: `${input.newScore}%` },
        { field: "passed", label: "Passed", oldValue: result.passed, newValue: newPassed },
      ],
      warnings: result.passed !== newPassed ? [{
        level: "warning",
        message: `Pass/fail status will change from ${result.passed ? "PASS" : "FAIL"} to ${newPassed ? "PASS" : "FAIL"}.`,
        messageAr: `ستتغير حالة النجاح/الرسوب من ${result.passed ? "ناجح" : "راسب"} إلى ${newPassed ? "ناجح" : "راسب"}.`,
      }] : [],
      expectedResult: `${result.traineeName}'s score will be ${input.newScore}% (${newPassed ? "PASS" : "FAIL"}).`,
      expectedResultAr: `ستكون درجة ${result.traineeName} هي ${input.newScore}% (${newPassed ? "ناجح" : "راسب"}).`,
      hydratedParams: {
        testResultId: result.id, testResultRef: result.refNumber,
        traineeName: result.traineeName, sessionRef: result.session.refNumber,
        oldScore: result.scorePercent, oldPassed: result.passed,
        newScore: input.newScore, newPassed,
        reason: input.reason ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const updated = await db.testResult.update({
      where: { id: p.testResultId as string },
      data: { scorePercent: p.newScore as number, passed: p.newPassed as boolean, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "EXAM",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI corrected score: ${p.traineeName} ${p.oldScore}% → ${p.newScore}% (${p.sessionRef})`,
      descriptionAr: `صحّح الذكاء الاصطناعي الدرجة: ${p.traineeName} ${p.oldScore}% → ${p.newScore}% (${p.sessionRef})`,
      req,
      oldValue: { scorePercent: p.oldScore, passed: p.oldPassed },
      newValue: { scorePercent: p.newScore, passed: p.newPassed },
      reason: (p.reason as string | null) ?? null,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "EXAM_CORRECT_SCORES",
      message: `Score corrected: ${p.traineeName} → ${p.newScore}% (${p.newPassed ? "PASS" : "FAIL"}).`,
      messageAr: `تم تصحيح الدرجة: ${p.traineeName} → ${p.newScore}% (${p.newPassed ? "ناجح" : "راسب"}).`,
      results: [],
    };
  },
};

// ─── EXAM_REGISTER_RE_EXAM ────────────────────────────────────────────────
interface ExamReExamInput {
  sessionId: string;
  traineeIds: string[];
  testType?: "PRE_TEST" | "FINAL_TEST";
}
const registerReExamExams: ActionHandler<ExamReExamInput> = {
  type: "EXAM_REGISTER_RE_EXAM",
  category: "EXAMS",
  description: "Register re-exam attempts for trainees who failed their first attempt. Creates new ExamAttempt rows with attemptNumber incremented.",
  descriptionAr: "تسجيل محاولات إعادة امتحان للمتدربين الذين رسبوا في محاولتهم الأولى.",
  resolvePermission: (role) => {
    if (role === "TRAINER" || role === "COORDINATOR" || role === "SUPER_ADMIN") {
      return { module: "final-test", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, user) {
    if (!input.sessionId || !input.traineeIds || input.traineeIds.length === 0) {
      throw new ActionError("sessionId and traineeIds[] are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (user.role === "TRAINER" && session.trainerId !== user.trainerId) {
      throw new ActionError("Trainers can only register re-exams for their own sessions", 403, "FORBIDDEN");
    }
    const trainees = await db.trainee.findMany({
      where: { id: { in: input.traineeIds }, deletedAt: null },
      select: { id: true, refNumber: true, fullName: true, email: true, nationalId: true, companyId: true },
    });
    if (trainees.length !== input.traineeIds.length) {
      throw new ActionError(`${input.traineeIds.length - trainees.length} trainee(s) not found`, 404, "TRAINEE_NOT_FOUND");
    }
    const testType = input.testType ?? "FINAL_TEST";
    return {
      actionType: "EXAM_REGISTER_RE_EXAM",
      title: "Register Re-Exam",
      titleAr: "تسجيل إعادة الامتحان",
      summary: `Register ${trainees.length} re-exam attempt(s) for ${testType} in ${session.refNumber}.`,
      summaryAr: `تسجيل ${trainees.length} محاولة إعادة امتحان (${testType === "PRE_TEST" ? "قبلي" : "نهائي"}) في ${session.refNumber}.`,
      affectedRecords: trainees.slice(0, 10).map((t) => ({ entity: "TRAINEE", refNumber: t.refNumber, description: t.fullName })),
      changes: trainees.slice(0, 20).map((t) => ({
        field: "reExam", label: t.fullName, oldValue: null, newValue: `Attempt #2`,
      })),
      warnings: [],
      expectedResult: `${trainees.length} re-exam attempt(s) will be created.`,
      expectedResultAr: `سيتم إنشاء ${trainees.length} محاولة إعادة امتحان.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        testType, trainees: trainees.map((t) => ({ id: t.id, ref: t.refNumber, name: t.fullName, email: t.email, nationalId: t.nationalId, companyId: t.companyId })),
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const trainees = p.trainees as Array<{ id: string; ref: string; name: string; email: string | null; nationalId: string | null; companyId: string | null }>;
    const testType = p.testType as "PRE_TEST" | "FINAL_TEST";
    const created: { id: string; refNumber: string }[] = [];
    await db.$transaction(async (tx) => {
      for (const t of trainees) {
        const refNumber = await nextRefNumber("EXAM", tx);
        const priorAttempts = await tx.examAttempt.count({
          where: { sessionId: p.sessionId as string, traineeName: t.name, testType, deletedAt: null },
        });
        const attempt = await tx.examAttempt.create({
          data: {
            refNumber,
            sessionId: p.sessionId as string,
            testType,
            traineeName: t.name,
            traineeEmail: t.email,
            traineeIdNational: t.nationalId,
            companyId: t.companyId,
            questionSet: "[]", // empty — actual exam engine will populate on start
            status: "ASSIGNED",
            attemptNumber: priorAttempts + 1,
            maxAttempts: 2,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        created.push({ id: attempt.id, refNumber: attempt.refNumber });
      }
    });
    await copilotAudit({
      user,
      action: "EXAM_SUBMIT",
      entity: "EXAM",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI registered ${created.length} re-exam attempts (${testType}) in ${p.sessionRef}`,
      descriptionAr: `سجّل الذكاء الاصطناعي ${created.length} محاولة إعادة امتحان (${testType}) في ${p.sessionRef}`,
      req,
      newValue: { count: created.length, testType },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "EXAM_REGISTER_RE_EXAM",
      message: `${created.length} re-exam attempt(s) registered.`,
      messageAr: `تم تسجيل ${created.length} محاولة إعادة امتحان.`,
      results: created.map((c) => ({ entity: "EXAM", id: c.id, refNumber: c.refNumber, description: "Re-exam attempt" })),
    };
  },
};

// ─── EXAM_CALCULATE_RESULTS ───────────────────────────────────────────────
interface CalculateResultsInput { sessionId: string; testType?: "PRE_TEST" | "FINAL_TEST"; }
const calculateResults: ActionHandler<CalculateResultsInput> = {
  type: "EXAM_CALCULATE_RESULTS",
  category: "EXAMS",
  description: "Calculate aggregated exam results for a session (pass rate, average score, distribution).",
  descriptionAr: "حساب نتائج الامتحان المجمعة لجلسة (نسبة النجاح، متوسط الدرجة، التوزيع).",
  resolvePermission: () => ({ module: "final-test", action: "view" }),
  async preparePreview(input, _user) {
    if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
    const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    return {
      actionType: "EXAM_CALCULATE_RESULTS",
      title: "Calculate Results",
      titleAr: "حساب النتائج",
      summary: `Calculate aggregated exam results for session ${session.refNumber}.`,
      summaryAr: `حساب النتائج المجمعة للجلسة ${session.refNumber}.`,
      affectedRecords: [{ entity: "SESSION", refNumber: session.refNumber, description: session.title }],
      changes: [],
      warnings: [],
      expectedResult: `Results will be computed and returned.`,
      expectedResultAr: `سيتم حساب النتائج وإرجاعها.`,
      hydratedParams: { sessionId: session.id, sessionRef: session.refNumber, testType: input.testType ?? "FINAL_TEST" },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const where = { sessionId: p.sessionId as string, testType: p.testType as "PRE_TEST" | "FINAL_TEST", deletedAt: null };
    const results = await db.testResult.findMany({ where, select: { scorePercent: true, passed: true, traineeName: true } });
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const avgScore = total > 0 ? Math.round(results.reduce((s, r) => s + r.scorePercent, 0) / total) : 0;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    await copilotAudit({
      user,
      action: "EXPORT",
      entity: "EXAM",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI calculated exam results for ${p.sessionRef}: ${total} total, ${passed} passed, ${failed} failed, avg=${avgScore}%, passRate=${passRate}%`,
      descriptionAr: `حسب الذكاء الاصطناعي نتائج الامتحان لـ ${p.sessionRef}: ${total} إجمالي، ${passed} ناجح، ${failed} راسب، المتوسط=${avgScore}%، نسبة النجاح=${passRate}%`,
      req,
      newValue: { total, passed, failed, avgScore, passRate, testType: p.testType },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "EXAM_CALCULATE_RESULTS",
      message: `Results: ${total} total, ${passed} passed (${passRate}%), ${failed} failed, avg=${avgScore}%`,
      messageAr: `النتائج: ${total} إجمالي، ${passed} ناجح (${passRate}%)، ${failed} راسب، المتوسط=${avgScore}%`,
      results: [
        { entity: "EXAM", description: `Total: ${total}` },
        { entity: "EXAM", description: `Passed: ${passed} (${passRate}%)` },
        { entity: "EXAM", description: `Failed: ${failed}` },
        { entity: "EXAM", description: `Average Score: ${avgScore}%` },
      ],
    };
  },
};

export const examActions: ActionHandler<any>[] = [registerScores, correctScore, registerReExamExams, calculateResults];
