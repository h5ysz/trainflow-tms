#!/usr/bin/env tsx
// =============================================================================
// GCCLAB TMS — End-to-End Production Simulation QA
// =============================================================================
// Branch under test: local/contractor-portal-enhancements
// (created from main; contractor-portal/matrix code was never actually committed
//  anywhere despite the prior summary's claim — see PHASE 13 for verification)
// =============================================================================

import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const ADMIN = { email: "admin@gcclab.com", password: "ChangeMeInProduction!2024" };

type Result = {
  step: string;
  status: "PASS" | "FAIL" | "SKIP" | "WARN";
  detail: string;
  payload?: unknown;
  httpStatus?: number;
  durationMs?: number;
};

const results: Result[] = [];

function log(r: Result) {
  results.push(r);
  const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : r.status === "WARN" ? "!" : "→";
  const line = `${icon} [${r.step}] ${r.detail}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ""}${r.durationMs ? ` ${r.durationMs}ms` : ""}`;
  console.log(line);
}

let cookie = "";
async function req(
  method: string,
  path: string,
  body?: unknown,
  expectStatus?: number
): Promise<{ status: number; json: any; text: string; ok: boolean; durationMs: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const start = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const durationMs = Date.now() - start;
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  const sc = res.headers.get("set-cookie");
  if (sc) {
    cookie = sc.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0]).join("; ");
  }
  const ok = expectStatus ? res.status === expectStatus : res.status >= 200 && res.status < 300;
  return { status: res.status, json, text, ok, durationMs };
}

const isoDate = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString();
};
const isoDateOnly = (offsetDays: number) => isoDate(offsetDays).slice(0, 10);

// ----------------------------------------------------------------------------
// PHASE 0 — Environment verification
// ----------------------------------------------------------------------------
async function phase0() {
  console.log("\n=== PHASE 0 — Environment Verification ===");
  const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  log({ step: "P0.branch", status: branch === "local/contractor-portal-enhancements" ? "PASS" : "FAIL",
        detail: `Current branch: ${branch}` });

  const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  log({ step: "P0.sha", status: "PASS", detail: `HEAD: ${sha.slice(0, 8)}` });

  const home = await req("GET", "/");
  log({ step: "P0.home", status: home.ok ? "PASS" : "FAIL",
        detail: `Home page reachable`, httpStatus: home.status, durationMs: home.durationMs });

  const apiRoot = await req("GET", "/api");
  log({ step: "P0.api", status: apiRoot.ok ? "PASS" : "FAIL",
        detail: `API root`, httpStatus: apiRoot.status, durationMs: apiRoot.durationMs });
}

// ----------------------------------------------------------------------------
// PHASE 1 — Admin login
// ----------------------------------------------------------------------------
async function phase1() {
  console.log("\n=== PHASE 1 — Admin Authentication ===");
  const login = await req("POST", "/api/auth/login", ADMIN);
  const user = login.json?.data?.user;
  log({
    step: "P1.login",
    status: login.ok && user ? "PASS" : "FAIL",
    detail: `Admin login: email=${user?.email ?? "FAIL"} role=${user?.role ?? "?"}`,
    httpStatus: login.status, durationMs: login.durationMs,
  });

  const me = await req("GET", "/api/auth/me");
  const meUser = me.json?.data;
  log({
    step: "P1.me",
    status: me.ok && meUser ? "PASS" : "FAIL",
    detail: `Session verified: ${meUser?.email ?? "no user"} role=${meUser?.role ?? "?"}`,
    httpStatus: me.status, durationMs: me.durationMs,
  });
}

// ----------------------------------------------------------------------------
// PHASE 2 — Create Company (contractor)
// ----------------------------------------------------------------------------
let companyId: string | undefined;
async function phase2() {
  console.log("\n=== PHASE 2 — Contractor (Company) Creation ===");
  const create = await req("POST", "/api/companies", {
    name: "QA Contractor LLC",
    nameAr: "مقاول ضمان الجودة",
    type: "CONTRACTOR",
    contactPerson: "Ahmed QA",
    contactEmail: "ahmed@qacontractor.test",
    contactPhone: "+966500000001",
    address: "Riyadh, Saudi Arabia",
    city: "Riyadh",
    country: "Saudi Arabia",
    crNumber: "CR-QA-0001",
    vatNumber: "VAT-QA-0001",
  });
  companyId = create.json?.data?.id;
  log({
    step: "P2.create-company",
    status: create.ok && companyId ? "PASS" : "FAIL",
    detail: `Created contractor company: ${create.json?.data?.name ?? "FAIL"} (id=${companyId ?? "?"}) ref=${create.json?.data?.refNumber ?? "?"}`,
    httpStatus: create.status, durationMs: create.durationMs,
  });

  const list = await req("GET", "/api/companies");
  log({
    step: "P2.list-companies",
    status: list.ok && (list.json?.data?.length ?? 0) >= 1 ? "PASS" : "FAIL",
    detail: `Companies list: ${list.json?.data?.length ?? 0} entries`,
    httpStatus: list.status, durationMs: list.durationMs,
  });
}

// ----------------------------------------------------------------------------
// PHASE 3 — Create Trainer + Course + Questions + Trainees
// ----------------------------------------------------------------------------
let trainerId: string | undefined;
let courseId: string | undefined;
let traineeIds: string[] = [];
async function phase3() {
  console.log("\n=== PHASE 3 — Trainer + Course + Question Bank + Trainees ===");
  // Trainer — uses fullName, not name
  const trainer = await req("POST", "/api/trainers", {
    fullName: "Khalid Trainer",
    fullNameAr: "خالد المدرب",
    nationalId: "QA-TID-0001",
    email: "khalid.trainer@qacontractor.test",
    phone: "+966500000002",
    nationality: "Saudi",
    gender: "M",
    status: "ACTIVE",
  });
  trainerId = trainer.json?.data?.id;
  log({
    step: "P3.create-trainer",
    status: trainer.ok && trainerId ? "PASS" : "FAIL",
    detail: `Created trainer: ${trainer.json?.data?.fullName ?? "FAIL"} (id=${trainerId ?? "?"}) ref=${trainer.json?.data?.refNumber ?? "?"}`,
    httpStatus: trainer.status, durationMs: trainer.durationMs,
  });

  // Course
  const course = await req("POST", "/api/courses", {
    code: "QA-HSE-001",
    title: "QA Basic HSE",
    titleAr: "السلامة الأساسية",
    description: "QA-only basic HSE training",
    category: "HSE",
    durationHours: 8,
    language: "en",
    validityMonths: 12,
    passScore: 70,
    maxTrainees: 20,
    hasPreTest: true,
    hasFinalTest: true,
    hasEvaluation: true,
    status: "ACTIVE",
  });
  courseId = course.json?.data?.id;
  log({
    step: "P3.create-course",
    status: course.ok && courseId ? "PASS" : "FAIL",
    detail: `Created course: ${course.json?.data?.title ?? "FAIL"} (id=${courseId ?? "?"}) code=${course.json?.data?.code ?? "?"}`,
    httpStatus: course.status, durationMs: course.durationMs,
  });

  // Trainees — must be created FIRST, before linking to a request course.
  // System requires MIN 10 trainees per course for approval.
  if (!companyId) {
    log({ step: "P3.skip-trainees", status: "SKIP", detail: "No companyId" });
    return;
  }
  let traineeOkCount = 0;
  for (let i = 1; i <= 10; i++) {
    const t = await req("POST", "/api/trainees", {
      fullName: `Trainee ${String(i).padStart(2, "0")} QA`,
      nationalId: `QA-NID-${String(i).padStart(4, "0")}`,
      nationality: "Saudi",
      jobTitle: "Field Worker",
      mobile: `+9665000000${String(9 + i).padStart(2, "0")}`,
      email: `trainee${i}@qacontractor.test`,
      companyId,
      status: "ACTIVE",
    });
    if (t.ok && t.json?.data?.id) {
      traineeIds.push(t.json.data.id);
      traineeOkCount++;
    }
  }
  log({
    step: "P3.create-trainees",
    status: traineeOkCount >= 10 ? "PASS" : "FAIL",
    detail: `Created ${traineeOkCount}/10 trainees (system MIN_TRAINEES_PER_COURSE=10). First ID: ${traineeIds[0] ?? "?"}`,
  });

  // Add trainer certification (REQUIRED before trainer can be assigned to a session for this course)
  if (trainerId && courseId) {
    const cert = await req("POST", `/api/trainer-certifications`, {
      trainerId,
      courseId,
      validFrom: isoDate(-30),
      validUntil: isoDate(365),
      status: "VALID",
      notes: "QA auto-certification",
    });
    log({
      step: "P3.certify-trainer",
      status: cert.ok ? "PASS" : "FAIL",
      detail: `Trainer certified for course: ${cert.ok ? "OK id=" + cert.json?.data?.id : cert.json?.error ?? "FAIL"}`,
      httpStatus: cert.status, durationMs: cert.durationMs,
    });
  }

  // Questions — schema: text, options: string[], correctAnswers: number[], courseId, testType
  const questionsData = [
    { text: "What does PPE stand for?", options: ["Personal Protective Equipment", "Public Protection Equipment", "Personal Public Equipment", "Private Protective Equipment"], correct: 0, testType: "PRE_TEST" },
    { text: "First action in an emergency?", options: ["Run", "Call for help / alarm", "Hide", "Panic"], correct: 1, testType: "PRE_TEST" },
    { text: "Color of fire extinguisher sign?", options: ["Green", "Blue", "Red", "Yellow"], correct: 2, testType: "PRE_TEST" },
    { text: "How often is HSE training refreshed?", options: ["Never", "Every 5 years", "Annually or per policy", "Only after incident"], correct: 2, testType: "PRE_TEST" },
    { text: "Who is responsible for site safety?", options: ["Only HSE officer", "Everyone on site", "Only contractors", "Only management"], correct: 1, testType: "PRE_TEST" },
    { text: "What does HOT WORK permit cover?", options: ["Working in heat", "Welding, cutting, grinding", "Hot weather", "Hot drinks"], correct: 1, testType: "FINAL_TEST" },
    { text: "Where is the assembly point?", options: ["Anywhere", "Designated safe area", "Inside the building", "In the parking lot only"], correct: 1, testType: "FINAL_TEST" },
    { text: "What is the buddy system?", options: ["Working alone", "Two-person rule for hazardous tasks", "A friend system", "Optional pairing"], correct: 1, testType: "FINAL_TEST" },
    { text: "Proper lifting technique?", options: ["Bend at waist", "Bend at knees, keep back straight", "Twist while lifting", "Lift quickly"], correct: 1, testType: "FINAL_TEST" },
    { text: "MSDS stands for?", options: ["Material Safety Data Sheet", "Manual Safety Document Standard", "Maintenance Schedule Data Sheet", "Multiple Safety Data Sources"], correct: 0, testType: "FINAL_TEST" },
  ];
  let qOk = 0;
  for (const q of questionsData) {
    const r = await req("POST", "/api/questions", {
      courseId,
      testType: q.testType,
      type: "SINGLE_CHOICE",
      text: q.text,
      options: q.options,
      correctAnswers: [q.correct],
      difficulty: "EASY",
      points: 1,
      order: 1,
      isActive: true,
    });
    if (r.ok) qOk++;
  }
  log({
    step: "P3.create-questions",
    status: qOk >= 10 ? "PASS" : "FAIL",
    detail: `Created ${qOk}/${questionsData.length} questions (5 PRE_TEST + 5 FINAL_TEST)`,
  });
}

// ----------------------------------------------------------------------------
// PHASE 4 — Submit contractor training request
// ----------------------------------------------------------------------------
let requestId: string | undefined;
async function phase4() {
  console.log("\n=== PHASE 4 — Contractor Training Request ===");
  if (!companyId || !courseId) {
    log({ step: "P4.skip", status: "SKIP", detail: "Missing companyId or courseId" });
    return;
  }
  // Create request with status SUBMITTED directly (skip DRAFT)
  const create = await req("POST", "/api/requests", {
    companyId,
    courseId,
    traineeCount: traineeIds.length,
    preferredDateFrom: isoDateOnly(7),
    preferredDateTo: isoDateOnly(14),
    preferredLocation: "QA Training Center — Riyadh",
    preferredLanguage: "en",
    notes: "QA E2E simulation request",
    priority: "NORMAL",
    status: "SUBMITTED",
  });
  requestId = create.json?.data?.id;
  log({
    step: "P4.submit-request",
    status: create.ok && requestId ? "PASS" : "FAIL",
    detail: `Submitted request ref=${create.json?.data?.refNumber ?? "?"} status=${create.json?.data?.status ?? "?"} (id=${requestId ?? "?"}) traineeCount=${create.json?.data?.traineeCount ?? "?"}`,
    httpStatus: create.status, durationMs: create.durationMs,
  });

  // Add course to request (creates TrainingRequestCourse row) — pass ALL 10 trainee IDs
  if (requestId) {
    const addCourse = await req("POST", `/api/requests/${requestId}/courses/${courseId}`, {
      traineeIds,
      notes: "QA auto-added course with all trainees",
    });
    log({
      step: "P4.add-course",
      status: addCourse.ok ? "PASS" : "FAIL",
      detail: `Added course to request: ${addCourse.ok ? "OK added=" + addCourse.json?.data?.added : addCourse.json?.error ?? "FAIL"}`,
      httpStatus: addCourse.status, durationMs: addCourse.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 5 — Approval workflow + session generation
// ----------------------------------------------------------------------------
let sessionId: string | undefined;
let requestCourseId: string | undefined;
async function phase5() {
  console.log("\n=== PHASE 5 — Approval Workflow + Session Generation ===");
  if (!requestId) {
    log({ step: "P5.skip", status: "SKIP", detail: "No requestId" });
    return;
  }

  // Workflow: SUBMITTED → UNDER_REVIEW → APPROVED (two-step per VALID_TRANSITIONS)
  const review = await req("PUT", `/api/requests/${requestId}`, { status: "UNDER_REVIEW" });
  log({
    step: "P5.under-review",
    status: review.ok && review.json?.data?.status === "UNDER_REVIEW" ? "PASS" : "FAIL",
    detail: `Review transition: newStatus=${review.json?.data?.status ?? review.json?.error ?? "FAIL"}`,
    httpStatus: review.status, durationMs: review.durationMs,
  });

  const approve = await req("PUT", `/api/requests/${requestId}`, { status: "APPROVED" });
  log({
    step: "P5.approve",
    status: approve.ok && approve.json?.data?.status === "APPROVED" ? "PASS" : "FAIL",
    detail: `Approve transition: newStatus=${approve.json?.data?.status ?? approve.json?.error ?? "FAIL"}`,
    httpStatus: approve.status, durationMs: approve.durationMs,
  });

  // GET /api/requests/[id]/generate-sessions to discover requestCourseId
  const genInfo = await req("GET", `/api/requests/${requestId}/generate-sessions`);
  const courses = genInfo.json?.data?.courses ?? [];
  requestCourseId = courses[0]?.requestCourseId;
  log({
    step: "P5.gen-info",
    status: genInfo.ok && requestCourseId ? "PASS" : "FAIL",
    detail: `Gen info: canGenerate=${genInfo.json?.data?.canGenerate ?? false} courses=${courses.length} requestCourseId=${requestCourseId ?? "?"}`,
    httpStatus: genInfo.status, durationMs: genInfo.durationMs,
  });

  // POST /api/requests/[id]/generate-sessions with explicit session spec
  if (requestCourseId && courseId) {
    const startDate = isoDate(7);
    const endDate = isoDate(7); // same day, 6 hours later
    const gen = await req("POST", `/api/requests/${requestId}/generate-sessions`, {
      sessions: [{
        requestCourseId,
        courseId,
        shift: "MORNING",
        startDate,
        endDate,
        city: "Riyadh",
        venue: "QA Training Center",
        capacity: 20,
        title: "QA HSE Session 1",
      }],
    });
    sessionId = gen.json?.data?.sessions?.[0]?.id ?? gen.json?.data?.id;
    log({
      step: "P5.generate-sessions",
      status: gen.ok && sessionId ? "PASS" : "FAIL",
      detail: `Generated session: id=${sessionId ?? "?"} ref=${gen.json?.data?.sessions?.[0]?.refNumber ?? gen.json?.data?.refNumber ?? "?"}`,
      httpStatus: gen.status, durationMs: gen.durationMs,
    });
  }

  // Assign trainer
  if (sessionId && trainerId) {
    const assign = await req("POST", `/api/sessions/${sessionId}/assign-trainer`, { trainerId });
    log({
      step: "P5.assign-trainer",
      status: assign.ok ? "PASS" : "FAIL",
      detail: `Trainer assigned to session: ${assign.ok ? "OK" : assign.json?.error ?? "FAIL"}`,
      httpStatus: assign.status, durationMs: assign.durationMs,
    });
  }

  // Activate QR window
  if (sessionId) {
    const qrActivate = await req("POST", `/api/sessions/${sessionId}/qr-activate`, {
      qrActiveFrom: isoDate(-1),
      qrActiveTo: isoDate(1),
    });
    log({
      step: "P5.qr-activate",
      status: qrActivate.ok ? "PASS" : "FAIL",
      detail: `QR window: ${qrActivate.ok ? "OK" : qrActivate.json?.error ?? "FAIL"} token=${qrActivate.json?.data?.qrCodeToken ? "(set)" : "(missing)"}`,
      httpStatus: qrActivate.status, durationMs: qrActivate.durationMs,
    });
  }

  // Lifecycle: STARTED (transition NOT_STARTED → STARTED) using eventType (not action)
  if (sessionId) {
    const activate = await req("POST", `/api/sessions/${sessionId}/lifecycle`, { eventType: "STARTED" });
    log({
      step: "P5.activate-session",
      status: activate.ok ? "PASS" : "FAIL",
      detail: `Session STARTED: ${activate.ok ? "OK → " + (activate.json?.data?.lifecycleStatus ?? "STARTED") : activate.json?.error ?? "FAIL"}`,
      httpStatus: activate.status, durationMs: activate.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 6 — Attendance via QR check-in
// ----------------------------------------------------------------------------
let qrToken: string | undefined;
async function phase6() {
  console.log("\n=== PHASE 6 — Attendance (QR Check-In) ===");
  if (!sessionId) {
    log({ step: "P6.skip", status: "SKIP", detail: "No sessionId" });
    return;
  }

  // Fetch session to get its qrCodeToken
  const sess = await req("GET", `/api/sessions/${sessionId}`);
  qrToken = sess.json?.data?.qrCodeToken;
  log({
    step: "P6.fetch-session",
    status: sess.ok && qrToken ? "PASS" : "FAIL",
    detail: `Session fetched: ref=${sess.json?.data?.refNumber ?? "?"} qrToken=${qrToken ? "(present)" : "(MISSING)"} attendance=${sess.json?.data?.attendance?.length ?? 0}`,
    httpStatus: sess.status, durationMs: sess.durationMs,
  });

  // Public check-in trainee 1 (only check in ONE trainee — the one we'll exam/certify)
  const c1 = await req("POST", `/api/public/check-in`, {
    qrCodeToken: qrToken,
    traineeName: "Trainee 01 QA",
    traineeIdNational: "QA-NID-0001",
    traineeEmail: "trainee1@qacontractor.test",
    traineePhone: "+966500000010",
    company: "QA Contractor LLC",
  });
  log({
    step: "P6.checkin-trainee1",
    status: c1.ok ? "PASS" : "FAIL",
    detail: `Check-in trainee 1: ${c1.ok ? "OK preTestAssigned=" + c1.json?.data?.preTestAssigned : c1.json?.error ?? "FAIL"}`,
    httpStatus: c1.status, durationMs: c1.durationMs,
  });

  // Public check-in trainee 2
  const c2 = await req("POST", `/api/public/check-in`, {
    qrCodeToken: qrToken,
    traineeName: "Trainee 02 QA",
    traineeIdNational: "QA-NID-0002",
    traineeEmail: "trainee2@qacontractor.test",
    traineePhone: "+966500000011",
    company: "QA Contractor LLC",
  });
  log({
    step: "P6.checkin-trainee2",
    status: c2.ok ? "PASS" : "FAIL",
    detail: `Check-in trainee 2: ${c2.ok ? "OK preTestAssigned=" + c2.json?.data?.preTestAssigned : c2.json?.error ?? "FAIL"}`,
    httpStatus: c2.status, durationMs: c2.durationMs,
  });

  // Verify attendance records exist
  const sess2 = await req("GET", `/api/sessions/${sessionId}`);
  const attCount = sess2.json?.data?.attendance?.length ?? 0;
  log({
    step: "P6.verify-attendance",
    status: attCount >= 2 ? "PASS" : "FAIL",
    detail: `Attendance records after check-ins: ${attCount} (need ≥2)`,
    httpStatus: sess2.status, durationMs: sess2.durationMs,
  });

  // Mark session COMPLETE — auto-creates FINAL_TEST attempts for PRESENT trainees
  // Lifecycle uses eventType (not action): one of STARTED, BREAK, RESUMED, COMPLETED
  const complete = await req("POST", `/api/sessions/${sessionId}/lifecycle`, { eventType: "COMPLETED" });
  log({
    step: "P6.complete-session",
    status: complete.ok ? "PASS" : "FAIL",
    detail: `Session COMPLETED: ${complete.ok ? "OK → " + (complete.json?.data?.lifecycleStatus ?? "COMPLETED") : complete.json?.error ?? "FAIL"}`,
    httpStatus: complete.status, durationMs: complete.durationMs,
  });
}

// ----------------------------------------------------------------------------
// PHASE 7 — Pre-Test (auto-assigned on check-in)
// ----------------------------------------------------------------------------
let preTestAttempt1: string | undefined;
async function phase7() {
  console.log("\n=== PHASE 7 — Pre-Test ===");
  if (!sessionId) {
    log({ step: "P7.skip", status: "SKIP", detail: "No sessionId" });
    return;
  }
  // Find the PRE_TEST attempt for trainee 1
  const list = await req("GET", `/api/exam-attempts?sessionId=${sessionId}&testType=PRE_TEST`);
  const attempts = list.json?.data ?? [];
  preTestAttempt1 = attempts.find((a: any) => a.traineeName === "Trainee 01 QA")?.id;
  log({
    step: "P7.find-pretest",
    status: preTestAttempt1 ? "PASS" : "FAIL",
    detail: `Pre-test attempt for trainee 1: id=${preTestAttempt1 ?? "?"} (found ${attempts.length} total PRE_TEST attempts)`,
    httpStatus: list.status, durationMs: list.durationMs,
  });

  // Start pre-test
  if (preTestAttempt1) {
    const start = await req("POST", `/api/exam-attempts/${preTestAttempt1}/start`, {});
    log({
      step: "P7.start-pretest",
      status: start.ok ? "PASS" : "FAIL",
      detail: `Started pre-test: status=${start.json?.data?.status ?? "?"} questions=${start.json?.data?.questionSet?.length ?? start.json?.data?.questions?.length ?? "?"}`,
      httpStatus: start.status, durationMs: start.durationMs,
    });

    // Get attempt details — questionSet contains optionsOrder (the shuffle permutation)
    const ver = await req("GET", `/api/exam-attempts/${preTestAttempt1}`);
    const questionSet = ver.json?.data?.questionSet ?? [];
    log({
      step: "P7.fetch-attempt",
      status: ver.ok && questionSet.length > 0 ? "PASS" : "FAIL",
      detail: `Fetched attempt: questionSet=${questionSet.length} status=${ver.json?.data?.status ?? "?"}`,
      httpStatus: ver.status, durationMs: ver.durationMs,
    });

    // Fetch questions from the bank to get correctAnswers (original indices)
    if (questionSet.length > 0) {
      const qList = await req("GET", `/api/questions?courseId=${courseId}&testType=PRE_TEST&pageSize=100`);
      const bankQuestions = qList.json?.data ?? [];
      const qMap = new Map(bankQuestions.map((q: any) => [q.id, q]));

      // Submit INTENTIONALLY WRONG answers (pre-test typically low score)
      const answers = questionSet.map((qsItem: any) => {
        const q = qMap.get(qsItem.questionId);
        const correctArr = q?.correctAnswers ?? [];
        const correctOrigIdx = Array.isArray(correctArr) && correctArr.length > 0 ? correctArr[0] : 0;
        // Pick a WRONG original index, then find its shuffled position
        const wrongOrigIdx = (correctOrigIdx + 1) % 4;
        const shuffledIdx = qsItem.optionsOrder.indexOf(wrongOrigIdx);
        return {
          questionId: qsItem.questionId,
          selectedAnswerIndices: [shuffledIdx],
        };
      });
      const submit = await req("POST", `/api/exam-attempts/${preTestAttempt1}/submit`, { answers });
      log({
        step: "P7.submit-pretest",
        status: submit.ok ? "PASS" : "FAIL",
        detail: `Pre-test submitted: score=${submit.json?.data?.scorePercent ?? "?"}% passed=${submit.json?.data?.passed ?? "?"}`,
        httpStatus: submit.status, durationMs: submit.durationMs,
      });
    }
  }
}

// ----------------------------------------------------------------------------
// PHASE 8 — Final Test (must pass at 70%)
// ----------------------------------------------------------------------------
let finalTestAttempt1: string | undefined;
async function phase8() {
  console.log("\n=== PHASE 8 — Final Test ===");
  if (!sessionId) {
    log({ step: "P8.skip", status: "SKIP", detail: "No sessionId" });
    return;
  }
  // Find the FINAL_TEST attempt for trainee 1 (auto-created on session COMPLETE)
  const list = await req("GET", `/api/exam-attempts?sessionId=${sessionId}&testType=FINAL_TEST`);
  const attempts = list.json?.data ?? [];
  finalTestAttempt1 = attempts.find((a: any) => a.traineeName === "Trainee 01 QA")?.id;
  log({
    step: "P8.find-finaltest",
    status: finalTestAttempt1 ? "PASS" : "FAIL",
    detail: `Final-test attempt for trainee 1: id=${finalTestAttempt1 ?? "?"} (found ${attempts.length} total FINAL_TEST attempts)`,
    httpStatus: list.status, durationMs: list.durationMs,
  });

  if (finalTestAttempt1) {
    const start = await req("POST", `/api/exam-attempts/${finalTestAttempt1}/start`, {});
    log({
      step: "P8.start-finaltest",
      status: start.ok ? "PASS" : "FAIL",
      detail: `Started final-test: status=${start.json?.data?.status ?? "?"} questions=${start.json?.data?.questionSet?.length ?? start.json?.data?.questions?.length ?? "?"}`,
      httpStatus: start.status, durationMs: start.durationMs,
    });

    const ver = await req("GET", `/api/exam-attempts/${finalTestAttempt1}`);
    const questionSet = ver.json?.data?.questionSet ?? [];
    log({
      step: "P8.fetch-attempt",
      status: ver.ok && questionSet.length > 0 ? "PASS" : "FAIL",
      detail: `Fetched attempt: questionSet=${questionSet.length} status=${ver.json?.data?.status ?? "?"}`,
      httpStatus: ver.status, durationMs: ver.durationMs,
    });

    // Submit CORRECT answers using correctAnswers indices (mapped through optionsOrder)
    if (questionSet.length > 0) {
      const qList = await req("GET", `/api/questions?courseId=${courseId}&testType=FINAL_TEST&pageSize=100`);
      const bankQuestions = qList.json?.data ?? [];
      const qMap = new Map(bankQuestions.map((q: any) => [q.id, q]));

      const answers = questionSet.map((qsItem: any) => {
        const q = qMap.get(qsItem.questionId);
        const correctArr = q?.correctAnswers ?? [];
        const correctOrigIdx = Array.isArray(correctArr) && correctArr.length > 0 ? correctArr[0] : 0;
        // Find the shuffled index that maps to the CORRECT original index
        const shuffledIdx = qsItem.optionsOrder.indexOf(correctOrigIdx);
        return {
          questionId: qsItem.questionId,
          selectedAnswerIndices: [shuffledIdx],
        };
      });
      const submit = await req("POST", `/api/exam-attempts/${finalTestAttempt1}/submit`, { answers });
      const score = submit.json?.data?.scorePercent;
      const passed = submit.json?.data?.passed;
      log({
        step: "P8.submit-finaltest",
        status: submit.ok && (passed === true || (typeof score === "number" && score >= 70)) ? "PASS" : "FAIL",
        detail: `Final-test submitted: score=${score ?? "?"}% passed=${passed ?? "?"} (passing=70%)`,
        httpStatus: submit.status, durationMs: submit.durationMs,
      });
    }
  }

  // Submit course evaluation (REQUIRED for certificate eligibility)
  if (sessionId) {
    const evalRes = await req("POST", `/api/evaluations`, {
      sessionId,
      trainerId,
      traineeName: "Trainee 01 QA",
      traineeEmail: "trainee1@qacontractor.test",
      traineeIdNational: "QA-NID-0001",
      companyId,
      trainerRating: 5,
      contentRating: 4,
      venueRating: 4,
      materialsRating: 5,
      overallRating: 5,
      comments: "Excellent QA training",
      suggestions: "More hands-on exercises",
      wouldRecommend: true,
    });
    log({
      step: "P8.submit-evaluation",
      status: evalRes.ok ? "PASS" : "FAIL",
      detail: `Course evaluation: ${evalRes.ok ? "OK id=" + evalRes.json?.data?.id : evalRes.json?.error ?? "FAIL"}`,
      httpStatus: evalRes.status, durationMs: evalRes.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 9 — Certificate Generation
// ----------------------------------------------------------------------------
let certificateId: string | undefined;
async function phase9() {
  console.log("\n=== PHASE 9 — Certificate Generation ===");
  if (!sessionId) {
    log({ step: "P9.skip", status: "SKIP", detail: "No sessionId" });
    return;
  }
  const gen = await req("POST", `/api/sessions/${sessionId}/generate-certificates`, {});
  const generated = gen.json?.data?.generated ?? 0;
  const results = gen.json?.data?.results ?? [];
  // Find trainee 1's certificate
  const certInfo = results.find((r: any) => r.traineeName === "Trainee 01 QA");
  if (certInfo?.certificateRef) {
    // Need to look up the actual certificate ID — fetch list filtered by session
    const certList = await req("GET", `/api/certificates?sessionId=${sessionId}`);
    certificateId = (certList.json?.data ?? []).find((c: any) => c.traineeName === "Trainee 01 QA")?.id;
  }
  log({
    step: "P9.generate-certificates",
    status: gen.ok && generated >= 1 ? "PASS" : "FAIL",
    detail: `Generated certificates: ${generated} issued, ${gen.json?.data?.skipped ?? 0} skipped. Trainee1 certId=${certificateId ?? "NONE"}`,
    httpStatus: gen.status, durationMs: gen.durationMs,
  });

  // Fetch certificate metadata
  if (certificateId) {
    const cert = await req("GET", `/api/certificates/${certificateId}`);
    log({
      step: "P9.fetch-certificate",
      status: cert.ok ? "PASS" : "FAIL",
      detail: `Certificate fetched: ref=${cert.json?.data?.refNumber ?? "?"} trainee=${cert.json?.data?.traineeName ?? "?"} status=${cert.json?.data?.status ?? "?"} score=${cert.json?.data?.finalScore ?? "?"}`,
      httpStatus: cert.status, durationMs: cert.durationMs,
    });

    // Generate PDF (endpoint is POST, not GET)
    const pdfRes = await fetch(`${BASE}/api/certificates/${certificateId}/generate-pdf`, {
      method: "POST", headers: { Cookie: cookie },
    });
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    log({
      step: "P9.generate-pdf",
      status: pdfRes.ok && pdfBuf.length > 1000 ? "PASS" : "FAIL",
      detail: `PDF generated: ${pdfBuf.length} bytes, content-type=${pdfRes.headers.get("content-type")}`,
      httpStatus: pdfRes.status,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 10 — Certificate Verification
// ----------------------------------------------------------------------------
async function phase10() {
  console.log("\n=== PHASE 10 — Certificate Verification ===");
  if (!certificateId) {
    log({ step: "P10.skip", status: "SKIP", detail: "No certificateId" });
    return;
  }
  const cert = await req("GET", `/api/certificates/${certificateId}`);
  const verifyToken = cert.json?.data?.verificationToken;
  log({
    step: "P10.fetch-token",
    status: verifyToken ? "PASS" : "WARN",
    detail: `Verification token: ${verifyToken ? "(present, len=" + verifyToken.length + ")" : "MISSING"}`,
  });

  if (verifyToken) {
    const verify = await req("GET", `/api/certificates/verify?token=${encodeURIComponent(verifyToken)}`);
    log({
      step: "P10.verify",
      status: verify.ok && verify.json?.success ? "PASS" : "FAIL",
      detail: `Verify result: valid=${verify.json?.data?.valid ?? "?"} validity=${verify.json?.data?.validity ?? "?"} trainee=${verify.json?.data?.certificate?.traineeName ?? "?"}`,
      httpStatus: verify.status, durationMs: verify.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 11 — Worker Passport
// ----------------------------------------------------------------------------
async function phase11() {
  console.log("\n=== PHASE 11 — Worker Passport ===");
  if (!traineeIds[0]) {
    log({ step: "P11.skip", status: "SKIP", detail: "No traineeIds[0]" });
    return;
  }
  const traineeId1 = traineeIds[0];
  // List passports — response shape: { data: { passports: [...], pagination: {...} } }
  const list = await req("GET", `/api/worker-passports`);
  const passports = list.json?.data?.passports ?? list.json?.data ?? [];
  const passportArr = Array.isArray(passports) ? passports : [];
  const passport = passportArr.find((p: any) => p.traineeId === traineeId1 || p.trainee?.id === traineeId1);
  log({
    step: "P11.list-passports",
    status: list.ok ? "PASS" : "FAIL",
    detail: `Passports list: ${passportArr.length} total, found for trainee1: ${passport ? "YES (id=" + passport.id + ")" : "NO"}`,
    httpStatus: list.status, durationMs: list.durationMs,
  });

  if (passport?.id) {
    const detail = await req("GET", `/api/worker-passports/${passport.id}`);
    const d = detail.json?.data;
    log({
      step: "P11.passport-detail",
      status: detail.ok ? "PASS" : "FAIL",
      detail: `Passport detail: ref=${d?.refNumber ?? d?.passportNumber ?? "?"} qr=${d?.qrToken ? "(present)" : "(missing)"} complianceScore=${d?.complianceScore ?? d?.compliancePercentage ?? "?"} certCount=${d?.certificates?.length ?? d?.certificateCount ?? "?"}`,
      httpStatus: detail.status, durationMs: detail.durationMs,
    });
  } else {
    // Auto-generation expected per passport-service.ts comments, but
    // src/app/api/sessions/[id]/generate-certificates/route.ts does NOT call
    // linkCertificateToPassport(). The passport-service.ts has the function but
    // no caller wires it into the certificate generation flow. This is a real bug.
    log({
      step: "P11.passport-detail",
      status: "FAIL",
      detail: `PASSPORT AUTO-GEN BUG: src/lib/worker/passport-service.ts exposes linkCertificateToPassport() but no caller in src/app/api/ wires it into certificate generation. Certificate was issued (CERT-2026-000001) but no WorkerPassport row was created.`,
    });
    // Try search by name as a fallback verification
    const search = await req("GET", `/api/worker-passports/search?q=Trainee+01+QA`);
    log({
      step: "P11.search-by-name",
      status: search.ok ? "PASS" : "FAIL",
      detail: `Search by name (fallback): ${search.json?.data?.length ?? search.json?.data?.passports?.length ?? 0} results`,
      httpStatus: search.status, durationMs: search.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 12 — Compliance Matrix
// ----------------------------------------------------------------------------
async function phase12() {
  console.log("\n=== PHASE 12 — Compliance Matrix ===");
  const rules = await req("GET", `/api/compliance/rules`);
  log({
    step: "P12.list-rules",
    status: rules.ok && (rules.json?.data?.length ?? 0) >= 3 ? "PASS" : "FAIL",
    detail: `Compliance rules: ${rules.json?.data?.length ?? 0} (seeded ≥3 core mandatory)`,
    httpStatus: rules.status, durationMs: rules.durationMs,
  });

  const exec = await req("GET", `/api/compliance/executive-dashboard`);
  const execData = exec.json?.data ?? {};
  const kpiCount = Object.keys(execData.kpis ?? execData).length;
  log({
    step: "P12.executive-dashboard",
    status: exec.ok ? "PASS" : "FAIL",
    detail: `Exec dashboard: KPIs=${kpiCount} charts=${Object.keys(execData.charts ?? {}).length}`,
    httpStatus: exec.status, durationMs: exec.durationMs,
  });

  const firstRule = rules.json?.data?.[0];
  if (firstRule?.id) {
    const versions = await req("GET", `/api/compliance/rules/${firstRule.id}/versions`);
    log({
      step: "P12.rule-versions",
      status: versions.ok ? "PASS" : "FAIL",
      detail: `Versions for rule ${firstRule.id.slice(0, 8)}: ${versions.json?.data?.length ?? 0}`,
      httpStatus: versions.status, durationMs: versions.durationMs,
    });
  }
}

// ----------------------------------------------------------------------------
// PHASE 13 — Training Matrix APIs (per user's request)
// ----------------------------------------------------------------------------
async function phase13() {
  console.log("\n=== PHASE 13 — Training Matrix APIs ===");
  // The previous summary claimed training matrix APIs were implemented.
  // Probe for them honestly:
  const probes = [
    { path: "/api/training-matrix", label: "list" },
    { path: "/api/training-matrix/versions", label: "versions" },
    { path: "/api/training-matrix/export", label: "export" },
    { path: "/api/training-matrix/import", label: "import" },
    { path: "/api/matrix", label: "matrix-alt" },
    { path: "/api/contractor-portal", label: "contractor-portal" },
    { path: "/api/contractor-portal/requests", label: "contractor-portal-requests" },
    { path: "/api/contractor-portal/submit", label: "contractor-portal-submit" },
  ];
  let missing = 0;
  for (const p of probes) {
    const r = await req("GET", p.path);
    const exists = r.status !== 404;
    if (!exists) missing++;
    log({
      step: `P13.probe-${p.label}`,
      status: exists ? "PASS" : "FAIL",
      detail: `${p.path}: HTTP ${r.status} ${exists ? "(endpoint EXISTS)" : "(404 — endpoint MISSING)"}`,
      httpStatus: r.status,
    });
  }

  // Audit log presence (a known-working reference)
  const audit = await req("GET", `/api/audit-log?pageSize=200`);
  const auditEntries = audit.json?.data ?? [];
  const actionTypes = new Set(auditEntries.map((e: any) => e.action));
  log({
    step: "P13.audit-log",
    status: audit.ok ? "PASS" : "FAIL",
    detail: `Audit log: ${auditEntries.length} entries, ${actionTypes.size} unique action types (${[...actionTypes].slice(0, 6).join(", ")}...)`,
    httpStatus: audit.status, durationMs: audit.durationMs,
  });

  // Summary line about missing endpoints
  log({
    step: "P13.summary",
    status: missing === 0 ? "PASS" : "FAIL",
    detail: `${missing}/${probes.length} training-matrix / contractor-portal endpoints MISSING`,
  });
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
(async () => {
  console.log("=".repeat(80));
  console.log("  GCCLAB TMS — End-to-End Production Simulation QA");
  console.log(`  Branch: local/contractor-portal-enhancements`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  await phase0();
  await phase1();
  await phase2();
  await phase3();
  await phase4();
  await phase5();
  await phase6();
  await phase7();
  await phase8();
  await phase9();
  await phase10();
  await phase11();
  await phase12();
  await phase13();

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("  QA SUMMARY");
  console.log("=".repeat(80));
  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const r of results) counts[r.status]++;
  console.log(`  PASS: ${counts.PASS} | FAIL: ${counts.FAIL} | WARN: ${counts.WARN} | SKIP: ${counts.SKIP}`);
  console.log("=".repeat(80));

  const fails = results.filter((r) => r.status === "FAIL");
  if (fails.length) {
    console.log("\nFAILURES:");
    for (const f of fails) console.log(`  ✗ [${f.step}] ${f.detail}`);
  }

  const report = {
    branch: "local/contractor-portal-enhancements",
    timestamp: new Date().toISOString(),
    summary: counts,
    results,
  };
  const fs = await import("node:fs/promises");
  await fs.writeFile("/home/z/my-project/download/qa-report.json", JSON.stringify(report, null, 2));
  console.log("\nFull JSON report: /home/z/my-project/download/qa-report.json");

  process.exit(counts.FAIL > 0 ? 1 : 0);
})();
