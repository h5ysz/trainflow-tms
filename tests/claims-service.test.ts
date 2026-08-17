// Trainer Claim service — workflow, ownership, snapshots, config effective-dating.
// DB is mocked (in-memory claim row + effective-date-filtered settings): these
// tests exercise the orchestration + state machine logic.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fakeDb, claimStore, settingStore } = vi.hoisted(() => {
  const m = () => vi.fn();

  const claimStore = { current: null as any };
  const settingStore = { rows: [] as any[] };

  const fakeDb: any = {
    trainer: { findFirst: m() },
    trainerClaim: {
      findUnique: vi.fn(async () => claimStore.current),
      findFirst: m(),
      create: vi.fn(async (args: any) => {
        claimStore.current = { ...claimStore.current, ...(args?.data ?? {}) };
        return claimStore.current;
      }),
      update: vi.fn(async (args: any) => {
        claimStore.current = { ...claimStore.current, ...(args?.data ?? {}) };
        return claimStore.current;
      }),
      findMany: m(),
      count: m(),
    },
    claimSetting: {
      findMany: vi.fn(async (args: any) => {
        const asOf = args?.where?.effectiveFrom?.lte;
        if (!asOf) return settingStore.rows;
        return settingStore.rows.filter((r) => r.effectiveFrom.getTime() <= asOf.getTime());
      }),
      findFirst: m(),
      create: m(),
    },
    trainingSession: { findMany: m() },
    trainerClaimItem: { findMany: m(), deleteMany: m(), createMany: m(), update: m() },
    refNumberCounter: { upsert: m() },
    $transaction: vi.fn(async (fn: any) => fn(fakeDb)),
  };

  return { fakeDb, claimStore, settingStore };
});

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "test-token" }), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("@/lib/auth/jwt", () => ({
  verifyToken: vi.fn(),
  signToken: vi.fn(() => "signed-token"),
  verifyPassword: vi.fn(),
}));

const {
  createClaim,
  generateClaimItems,
  adjustClaimItem,
  submitClaim,
  approveClaim,
  returnClaim,
  rejectClaim,
  finalizeClaim,
  softDeleteClaim,
  acknowledgeClaim,
  lineManagerReview,
  qhseReview,
  hrReview,
  startManagerReview,
} = await import("@/lib/claims/service");
const { ApiError } = await import("@/lib/auth/api");
const { getClaimConfig, setClaimSetting } = await import("@/lib/claims/config");

const TRAINER_ID = "trn-1";
const CLAIM_ID = "cl-1";

const ME = { id: "user-1", fullName: "Nawaf Coordinator" };
const TRAINER_USER = { id: "user-2", fullName: "Yasser Trainer", trainerId: TRAINER_ID };

function claimFixture(over: Record<string, unknown> = {}): any {
  return {
    id: CLAIM_ID,
    refNumber: "CL-2026-000001",
    claimType: "OVERTIME",
    engagementType: "EMPLOYEE",
    trainerId: TRAINER_ID,
    status: "DRAFT",
    periodFrom: new Date("2026-06-22T00:00:00.000Z"),
    periodTo: new Date("2026-06-28T00:00:00.000Z"),
    dailyAllowance: null,
    mainLocation: null,
    notes: null,
    history: null,
    totalHours: 0,
    totalDays: 0,
    totalAmount: 0,
    currency: "SAR",
    generatedAt: null,
    generatedBy: null,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    returnedAt: null,
    returnedBy: null,
    returnReason: null,
    finalizedAt: null,
    finalizedBy: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    deletedAt: null,
    trainer: { id: TRAINER_ID, refNumber: "TRN-000012", nameEn: "Yasser Trainer", nameAr: null, engagementType: "EMPLOYEE" },
    items: [],
    ...over,
  };
}

function sessionFixture(over: Record<string, unknown> = {}): any {
  return {
    id: "ses-1",
    refNumber: "SES-2026-000001",
    course: { id: "c-1", code: "OSH-101", title: "OHS Awareness" },
    trainer: { id: TRAINER_ID, nameEn: "Yasser Trainer", nameAr: null },
    request: { coordinator: { id: "user-1", fullName: "Nawaf Coordinator" } },
    city: "Al Qassim",
    location: null,
    shift: "EVENING",
    durationHours: 6,
    startDate: new Date("2026-06-22T00:00:00.000Z"),
    endDate: new Date("2026-06-22T00:00:00.000Z"),
    ...over,
  };
}

function defaultSettings(): any[] {
  return [
    { key: "MAIN_LOCATION", value: "Dammam", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
    { key: "EMPLOYEE_DAILY_ALLOWANCE", value: "600", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
    { key: "CONTRACTOR_DAILY_ALLOWANCE", value: "900", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  claimStore.current = claimFixture();
  settingStore.rows = defaultSettings();

  fakeDb.trainer.findFirst.mockResolvedValue({
    id: TRAINER_ID,
    refNumber: "TRN-000012",
    nameEn: "Yasser Trainer",
    nameAr: null,
    engagementType: "EMPLOYEE",
  });
  fakeDb.trainerClaim.findFirst.mockResolvedValue(null);
  fakeDb.trainingSession.findMany.mockResolvedValue([sessionFixture()]);
  fakeDb.trainerClaimItem.findMany.mockResolvedValue([]);
  fakeDb.claimSetting.findFirst.mockResolvedValue({ id: "cs-1", key: "MAIN_LOCATION" });
  fakeDb.refNumberCounter.upsert.mockResolvedValue({ sequence: 1 });
});

describe("createClaim", () => {
  it("creates a DRAFT claim snapshotting the trainer's engagement type", async () => {
    const claim = await createClaim(
      { claimType: "OVERTIME", trainerId: TRAINER_ID, periodFrom: "2026-06-22", periodTo: "2026-06-28" },
      ME,
    );
    expect(claim.status).toBe("DRAFT");
    expect(claim.engagementType).toBe("EMPLOYEE");
    expect(claim.refNumber).toBe("CL-2026-000001");
    expect(JSON.parse(claim.history as string)[0].action).toBe("CREATED");
  });

  it("rejects an overlapping claim for the same trainer/type/period", async () => {
    fakeDb.trainerClaim.findFirst.mockResolvedValue({ id: "cl-other", refNumber: "CL-2026-000002" });
    await expect(
      createClaim({ claimType: "OVERTIME", trainerId: TRAINER_ID, periodFrom: "2026-06-20", periodTo: "2026-06-30" }, ME),
    ).rejects.toMatchObject({ status: 409, code: "CLAIM_OVERLAP" });
  });

  it("maps a CONTRACTOR trainer to CONTRACTOR engagement", async () => {
    fakeDb.trainer.findFirst.mockResolvedValue({ id: TRAINER_ID, engagementType: "CONTRACTOR", nameEn: "Yasser" });
    const claim = await createClaim(
      { claimType: "BUSINESS_MISSION", trainerId: TRAINER_ID, periodFrom: "2026-06-22", periodTo: "2026-06-28" },
      ME,
    );
    expect(claim.engagementType).toBe("CONTRACTOR");
  });

  it("throws when the trainer does not exist", async () => {
    fakeDb.trainer.findFirst.mockResolvedValue(null);
    await expect(
      createClaim({ claimType: "OVERTIME", trainerId: "nope", periodFrom: "2026-06-22", periodTo: "2026-06-28" }, ME),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects invalid periods", async () => {
    await expect(
      createClaim({ claimType: "OVERTIME", trainerId: TRAINER_ID, periodFrom: "not-a-date", periodTo: "2026-06-28" }, ME),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      createClaim({ claimType: "OVERTIME", trainerId: TRAINER_ID, periodFrom: "2026-06-30", periodTo: "2026-06-22" }, ME),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("generateClaimItems", () => {
  it("only regenerates while DRAFT/GENERATED/RETURNED", async () => {
    claimStore.current = claimFixture({ status: "APPROVED" });
    await expect(generateClaimItems(CLAIM_ID, ME)).rejects.toMatchObject({ status: 409, code: "BAD_STATUS" });
  });

  it("snapshots the main location and moves the claim to GENERATED", async () => {
    fakeDb.trainingSession.findMany.mockResolvedValue([sessionFixture({ city: "Al Qassim" })]);
    const claim = await generateClaimItems(CLAIM_ID, ME);
    expect(claim.status).toBe("GENERATED");
    expect(claim.mainLocation).toBe("Dammam");
    expect(claim.totalHours).toBe(4); // Monday, employee OT cap
    expect(claim.totalDays).toBe(0);
  });

  it("stores a business-mission rate snapshot from the config", async () => {
    claimStore.current = claimFixture({ claimType: "BUSINESS_MISSION" });
    const claim = await generateClaimItems(CLAIM_ID, ME);
    expect(claim.status).toBe("GENERATED");
    expect(claim.dailyAllowance).toBe(600);
    expect(claim.totalDays).toBe(1);
    expect(claim.totalAmount).toBe(600);
  });
});

describe("adjustClaimItem", () => {
  function itemFixture(over: Record<string, unknown> = {}): any {
    return {
      id: "item-1",
      sessionId: "ses-1",
      date: new Date("2026-06-22T00:00:00.000Z"),
      originalValue: 4,
      finalValue: 4,
      unit: "HOURS",
      rate: null,
      amount: null,
      ...over,
    };
  }

  it("rejects a trainer who is not the claim owner", async () => {
    claimStore.current = claimFixture({ status: "GENERATED" });
    await expect(
      adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: 3, reason: "short session" }, { id: "user-x", fullName: "Other", trainerId: "trn-other" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires a reason and a non-negative value", async () => {
    claimStore.current = claimFixture({ status: "GENERATED" });
    await expect(
      adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: 3, reason: "  " }, TRAINER_USER),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: -1, reason: "oops" }, TRAINER_USER),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("is blocked once the claim is approved", async () => {
    claimStore.current = claimFixture({ status: "APPROVED" });
    await expect(
      adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: 3, reason: "typo" }, TRAINER_USER),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reverts to the original value (clears adjustment) when the new value equals it", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", items: [itemFixture()] });
    fakeDb.trainerClaimItem.findMany.mockResolvedValue([itemFixture()]);
    await adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: 4, reason: "back to original" }, TRAINER_USER);
    const updateCall = fakeDb.trainerClaimItem.update.mock.calls[0][0] as any;
    expect(updateCall.data.adjustedValue).toBeNull();
    expect(updateCall.data.finalValue).toBe(4);
  });

  it("applies a real adjustment and recomputes totals", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", items: [itemFixture()] });
    fakeDb.trainerClaimItem.findMany.mockResolvedValue([itemFixture({ finalValue: 3 })]);
    await adjustClaimItem(CLAIM_ID, { itemId: "item-1", value: 3, reason: "half day only" }, TRAINER_USER);
    const updateCall = fakeDb.trainerClaimItem.update.mock.calls[0][0] as any;
    expect(updateCall.data.adjustedValue).toBe(3);
    const claimUpdate = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(claimUpdate.data.totalHours).toBe(3);
  });
});

describe("workflow transitions", () => {
  it("submit requires the owner and a DRAFT/GENERATED/RETURNED state", async () => {
    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await expect(submitClaim(CLAIM_ID, TRAINER_USER)).rejects.toMatchObject({ status: 409 });

    claimStore.current = claimFixture({ status: "DRAFT" });
    await submitClaim(CLAIM_ID, TRAINER_USER);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("SUBMITTED");

    fakeDb.trainerClaim.update.mockClear();

    claimStore.current = claimFixture({ status: "GENERATED" });
    await submitClaim(CLAIM_ID, TRAINER_USER);
    const call2 = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call2.data.status).toBe("SUBMITTED");
  });

  it("approve only accepts SUBMITTED or HR_REVIEW", async () => {
    claimStore.current = claimFixture({ status: "GENERATED" });
    await expect(approveClaim(CLAIM_ID, ME)).rejects.toMatchObject({ status: 409 });

    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await approveClaim(CLAIM_ID, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("APPROVED");

    // Also accepts HR_REVIEW
    fakeDb.trainerClaim.update.mockClear();
    claimStore.current = claimFixture({ status: "HR_REVIEW" });
    await approveClaim(CLAIM_ID, ME);
    const call2 = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call2.data.status).toBe("APPROVED");
  });

  it("return requires a reason and accepts SUBMITTED/LINE_MANAGER_REVIEW/QHSE_REVIEW/HR_REVIEW", async () => {
    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await expect(returnClaim(CLAIM_ID, ME, "   ")).rejects.toMatchObject({ status: 422 });

    await returnClaim(CLAIM_ID, ME, "missing session");
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("RETURNED");
    expect(call.data.returnReason).toBe("missing session");

    // LINE_MANAGER_REVIEW
    fakeDb.trainerClaim.update.mockClear();
    claimStore.current = claimFixture({ status: "LINE_MANAGER_REVIEW" });
    await returnClaim(CLAIM_ID, ME, "LM rejected");
    const call2 = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call2.data.status).toBe("RETURNED");

    // QHSE_REVIEW
    fakeDb.trainerClaim.update.mockClear();
    claimStore.current = claimFixture({ status: "QHSE_REVIEW" });
    await returnClaim(CLAIM_ID, ME, "QHSE concern");
    const call3 = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call3.data.status).toBe("RETURNED");

    // HR_REVIEW
    fakeDb.trainerClaim.update.mockClear();
    claimStore.current = claimFixture({ status: "HR_REVIEW" });
    await returnClaim(CLAIM_ID, ME, "HR rejected");
    const call4 = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call4.data.status).toBe("RETURNED");
  });

  it("finalize only accepts APPROVED", async () => {
    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await expect(finalizeClaim(CLAIM_ID, ME)).rejects.toMatchObject({ status: 409 });

    claimStore.current = claimFixture({ status: "APPROVED" });
    await finalizeClaim(CLAIM_ID, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("FINAL");
  });

  it("softDelete only accepts DRAFT/GENERATED/RETURNED", async () => {
    claimStore.current = claimFixture({ status: "APPROVED" });
    await expect(softDeleteClaim(CLAIM_ID, ME)).rejects.toMatchObject({ status: 409 });

    claimStore.current = claimFixture({ status: "DRAFT" });
    await softDeleteClaim(CLAIM_ID, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe("HRD-FO-052 workflow transitions", () => {
  it("startManagerReview moves SUBMITTED → LINE_MANAGER_REVIEW", async () => {
    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await startManagerReview(CLAIM_ID, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("LINE_MANAGER_REVIEW");
  });

  it("startManagerReview rejects non-SUBMITTED claims", async () => {
    claimStore.current = claimFixture({ status: "GENERATED" });
    await expect(startManagerReview(CLAIM_ID, ME)).rejects.toMatchObject({ status: 409 });
  });

  it("acknowledgeClaim updates employee info and acknowledgment", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", engagementType: "EMPLOYEE" });
    await acknowledgeClaim(
      CLAIM_ID,
      { accepted: true, requestedBy: "Nawaf", reason: "Project deadline", normalWorkingHours: 8, estimatedOtPerDay: 4 },
      TRAINER_USER,
    );
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.acknowledgmentAccepted).toBe(true);
    expect(call.data.requestedBy).toBe("Nawaf");
    expect(call.data.reason).toBe("Project deadline");
    expect(call.data.normalWorkingHoursPerDay).toBe(8);
    expect(call.data.estimatedOtPerDay).toBe(4);
  });

  it("acknowledgeClaim rejects CONTRACTOR claims", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", engagementType: "CONTRACTOR" });
    await expect(
      acknowledgeClaim(CLAIM_ID, { accepted: true }, TRAINER_USER),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lineManagerReview APPROVED → QHSE_REVIEW", async () => {
    claimStore.current = claimFixture({ status: "LINE_MANAGER_REVIEW" });
    await lineManagerReview(CLAIM_ID, { decision: "APPROVED", comments: "All good" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("QHSE_REVIEW");
    expect(call.data.lineManagerDecision).toBe("APPROVED");
    expect(call.data.lineManagerComments).toBe("All good");
    expect(call.data.lineManagerSignatureBy).toBe(ME.fullName);
  });

  it("lineManagerReview NOT_APPROVED → RETURNED", async () => {
    claimStore.current = claimFixture({ status: "LINE_MANAGER_REVIEW" });
    await lineManagerReview(CLAIM_ID, { decision: "NOT_APPROVED", comments: "Insufficient justification" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("RETURNED");
    expect(call.data.returnReason).toBe("Insufficient justification");
  });

  it("qhseReview ACCEPTABLE → HR_REVIEW", async () => {
    claimStore.current = claimFixture({ status: "QHSE_REVIEW" });
    await qhseReview(CLAIM_ID, { assessment: "ACCEPTABLE" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("HR_REVIEW");
    expect(call.data.qhseAssessment).toBe("ACCEPTABLE");
  });

  it("qhseReview NOT_RECOMMENDED → RETURNED", async () => {
    claimStore.current = claimFixture({ status: "QHSE_REVIEW" });
    await qhseReview(CLAIM_ID, { assessment: "NOT_RECOMMENDED", controls: "Safety risk" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("RETURNED");
    expect(call.data.returnReason).toBe("Safety risk");
  });

  it("hrReview APPROVED → APPROVED with timestamps", async () => {
    claimStore.current = claimFixture({ status: "HR_REVIEW" });
    await hrReview(CLAIM_ID, { decision: "APPROVED", maxApprovedOt: 16, periodFrom: "2026-06-22", periodTo: "2026-06-28", comments: "Approved" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("APPROVED");
    expect(call.data.hrDecision).toBe("APPROVED");
    expect(call.data.hrMaxApprovedOt).toBe(16);
    expect(call.data.hrApprovedPeriodFrom).toBeInstanceOf(Date);
    expect(call.data.approvedAt).toBeInstanceOf(Date);
    expect(call.data.approvedBy).toBe(ME.id);
  });

  it("hrReview NOT_APPROVED → RETURNED", async () => {
    claimStore.current = claimFixture({ status: "HR_REVIEW" });
    await hrReview(CLAIM_ID, { decision: "NOT_APPROVED", comments: "Exceeds budget" }, ME);
    const call = fakeDb.trainerClaim.update.mock.calls[0][0] as any;
    expect(call.data.status).toBe("RETURNED");
    expect(call.data.returnReason).toBe("Exceeds budget");
  });

  it("full HRD-FO-052 happy path: SUBMITTED → LM → QHSE → HR → APPROVED", async () => {
    // Step 1: Forward to LM
    claimStore.current = claimFixture({ status: "SUBMITTED" });
    await startManagerReview(CLAIM_ID, ME);
    expect(claimStore.current.status).toBe("LINE_MANAGER_REVIEW");

    // Step 2: LM approves
    await lineManagerReview(CLAIM_ID, { decision: "APPROVED" }, ME);
    expect(claimStore.current.status).toBe("QHSE_REVIEW");

    // Step 3: QHSE accepts
    await qhseReview(CLAIM_ID, { assessment: "ACCEPTABLE" }, ME);
    expect(claimStore.current.status).toBe("HR_REVIEW");

    // Step 4: HR approves
    await hrReview(CLAIM_ID, { decision: "APPROVED" }, ME);
    expect(claimStore.current.status).toBe("APPROVED");
  });
});

describe("coordinator workflow", () => {
  it("submitClaim sets PENDING_COORDINATOR_APPROVAL when coordinatorId is set", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", coordinatorId: "coord-1" });
    await submitClaim(CLAIM_ID, TRAINER_USER);
    expect(claimStore.current.status).toBe("PENDING_COORDINATOR_APPROVAL");
  });

  it("submitClaim sets SUBMITTED when no coordinatorId", async () => {
    claimStore.current = claimFixture({ status: "GENERATED", coordinatorId: null });
    await submitClaim(CLAIM_ID, TRAINER_USER);
    expect(claimStore.current.status).toBe("SUBMITTED");
  });

  it("approveClaim allows assigned coordinator to approve PENDING_COORDINATOR_APPROVAL", async () => {
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "user-1" });
    await approveClaim(CLAIM_ID, { id: "user-1", fullName: "Nawaf", role: "COORDINATOR" });
    expect(claimStore.current.status).toBe("APPROVED");
  });

  it("approveClaim rejects non-assigned coordinator", async () => {
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "other-coord" });
    await expect(
      approveClaim(CLAIM_ID, { id: "user-1", fullName: "Nawaf", role: "COORDINATOR" })
    ).rejects.toThrow("claims assigned to you");
  });

  it("approveClaim allows SUPER_ADMIN to approve any claim", async () => {
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "other-coord" });
    await approveClaim(CLAIM_ID, { id: "admin-1", fullName: "Admin", role: "SUPER_ADMIN" });
    expect(claimStore.current.status).toBe("APPROVED");
  });

  it("rejectClaim sets REJECTED status with reason", async () => {
    const { rejectClaim } = await import("@/lib/claims/service");
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "user-1" });
    await rejectClaim(CLAIM_ID, { id: "user-1", fullName: "Nawaf", role: "COORDINATOR" }, "Incomplete documentation");
    expect(claimStore.current.status).toBe("REJECTED");
    expect(claimStore.current.returnReason).toBe("Incomplete documentation");
  });

  it("rejectClaim rejects non-assigned coordinator", async () => {
    const { rejectClaim } = await import("@/lib/claims/service");
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "other-coord" });
    await expect(
      rejectClaim(CLAIM_ID, { id: "user-1", fullName: "Nawaf", role: "COORDINATOR" }, "reason")
    ).rejects.toThrow("claims assigned to you");
  });

  it("returnClaim allows PENDING_COORDINATOR_APPROVAL status", async () => {
    claimStore.current = claimFixture({ status: "PENDING_COORDINATOR_APPROVAL", coordinatorId: "user-1" });
    await returnClaim(CLAIM_ID, { id: "user-1", fullName: "Nawaf", role: "COORDINATOR" }, "Needs revision");
    expect(claimStore.current.status).toBe("RETURNED");
  });
});

describe("claim config effective-dating", () => {
  it("picks the latest effectiveFrom at or before asOf", async () => {
    settingStore.rows = [
      { key: "MAIN_LOCATION", value: "Riyadh", effectiveFrom: new Date("2026-07-01T00:00:00.000Z") },
      { key: "MAIN_LOCATION", value: "Dammam", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
      { key: "EMPLOYEE_DAILY_ALLOWANCE", value: "700", effectiveFrom: new Date("2026-07-01T00:00:00.000Z") },
      { key: "EMPLOYEE_DAILY_ALLOWANCE", value: "600", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
      { key: "CONTRACTOR_DAILY_ALLOWANCE", value: "900", effectiveFrom: new Date("2020-01-01T00:00:00.000Z") },
    ];
    const before = await getClaimConfig(new Date("2026-06-15T00:00:00.000Z"));
    expect(before.mainLocation).toBe("Dammam");
    expect(before.employeeDailyAllowance).toBe(600);

    const after = await getClaimConfig(new Date("2026-07-15T00:00:00.000Z"));
    expect(after.mainLocation).toBe("Riyadh");
    expect(after.employeeDailyAllowance).toBe(700);
  });

  it("falls back to defaults when no rows exist", async () => {
    settingStore.rows = [];
    const config = await getClaimConfig();
    expect(config).toEqual({ mainLocation: "Dammam", employeeDailyAllowance: 600, contractorDailyAllowance: 900, normalWorkingHoursPerDay: 8, contractorRatePerDay: 700 });
  });

  it("setClaimSetting is idempotent per (key, value, effectiveFrom)", async () => {
    fakeDb.claimSetting.findFirst.mockResolvedValue({
      id: "cs-1",
      key: "EMPLOYEE_DAILY_ALLOWANCE",
      value: "650",
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    });
    const row = await setClaimSetting("EMPLOYEE_DAILY_ALLOWANCE", "650", new Date("2026-07-01T00:00:00.000Z"), "user-1");
    expect(row.id).toBe("cs-1");
    expect(fakeDb.claimSetting.create).not.toHaveBeenCalled();
  });
});

describe("ApiError shape", () => {
  it("carries status + code", () => {
    const err = new ApiError(422, "boom", "VALIDATION_ERROR");
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("boom");
  });
});
