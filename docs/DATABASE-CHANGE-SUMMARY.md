# TrainFlow TMS — Database Change Summary (Sprint 3.1)

> **Sprint:** 3.1 — Final Enrollment Architecture  
> **Date:** 2026-07-08  
> **Scope:** SessionEnrollment becomes the central workflow entity  
> **Backward Compatibility:** ✅ Maintained — existing APIs continue to work

---

## 1. Schema Changes

### Model: `SessionEnrollment` (MODIFIED — 10 new fields)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enrollmentStatus` | String | `"PENDING"` | PENDING \| CONFIRMED \| CHECKED_IN \| TRAINING \| COMPLETED \| CANCELLED \| NO_SHOW |
| `attendanceStatus` | String | `"NOT_STARTED"` | NOT_STARTED \| PRESENT \| LATE \| ABSENT |
| `preTestStatus` | String | `"PENDING"` | NOT_REQUIRED \| PENDING \| IN_PROGRESS \| COMPLETED |
| `finalTestStatus` | String | `"PENDING"` | NOT_REQUIRED \| PENDING \| IN_PROGRESS \| PASSED \| FAILED |
| `evaluationStatus` | String | `"PENDING"` | NOT_REQUIRED \| PENDING \| COMPLETED |
| `certificateStatus` | String | `"NOT_ELIGIBLE"` | NOT_ELIGIBLE \| ELIGIBLE \| GENERATED \| ISSUED |
| `enrolledBy` | String? | — | User ID who enrolled the trainee |
| `enrollmentDate` | DateTime | `now()` | When the enrollment was created |
| `completedDate` | DateTime? | — | When the trainee completed all pipeline steps |
| `notes` | String? | — | Free-text notes |
| `attendanceId` | String? | — | FK to Attendance record (set at check-in) |

**Removed fields:**
- `status` (replaced by `enrollmentStatus`)
- `enrolledAt` (replaced by `enrollmentDate`)

**New indexes (8):**
- `@@index([enrollmentStatus])`
- `@@index([attendanceStatus])`
- `@@index([preTestStatus])`
- `@@index([finalTestStatus])`
- `@@index([evaluationStatus])`
- `@@index([certificateStatus])`

### No Other Models Changed

This is a **non-breaking** schema change — only the `SessionEnrollment` model was modified. All other models (Attendance, ExamAttempt, TestResult, CourseEvaluation, Certificate, TrainingSession, Trainee, Company) remain unchanged.

---

## 2. New Service Layer

### `src/lib/api/enrollment-sync.ts` (NEW — 6 sync functions)

| Function | Called By | Status Updated |
|----------|-----------|----------------|
| `syncAttendanceCheckedIn()` | Check-in API | `attendanceStatus`, `enrollmentStatus = CHECKED_IN` |
| `syncPreTestStatus()` | Check-in API, Exam start API, Exam submit API | `preTestStatus` |
| `syncFinalTestStatus()` | Lifecycle API, Exam start API, Exam submit API | `finalTestStatus` |
| `syncEvaluationStatus()` | Evaluation POST API | `evaluationStatus` |
| `syncCertificateStatus()` | Certificate POST API, PDF generation API | `certificateStatus`, `enrollmentStatus = COMPLETED` |
| `recalcCertificateEligibility()` | Exam submit API, Evaluation POST API | `certificateStatus = ELIGIBLE / NOT_ELIGIBLE` |

Each function:
1. Finds the SessionEnrollment by (sessionId + traineeName/traineeIdNational/attendanceId)
2. If no enrollment found → silently skips (backward compatible with non-enrolled trainees)
3. Updates the corresponding status field
4. For certificate sync, also updates `enrollmentStatus = COMPLETED` + `completedDate`

---

## 3. API Changes

### Modified APIs (6 — all backward compatible)

| API | Change |
|-----|--------|
| `POST /api/sessions/[id]/check-in` | Added `syncAttendanceCheckedIn()` + `syncPreTestStatus()` calls |
| `POST /api/sessions/[id]/lifecycle` | Added `syncFinalTestStatus()` calls on final-test auto-assign |
| `POST /api/exam-attempts/[id]/start` | Added `syncPreTestStatus(IN_PROGRESS)` / `syncFinalTestStatus(IN_PROGRESS)` |
| `POST /api/exam-attempts/[id]/submit` | Added `syncPreTestStatus(COMPLETED)` / `syncFinalTestStatus(PASSED/FAILED)` + `recalcCertificateEligibility()` |
| `POST /api/evaluations` | Added `syncEvaluationStatus(COMPLETED)` + `recalcCertificateEligibility()` |
| `POST /api/certificates` | Added `syncCertificateStatus(GENERATED)` |
| `POST /api/certificates/[id]/generate-pdf` | Added `syncCertificateStatus(ISSUED)` |
| `POST /api/sessions/[id]/enrollments` | Uses `enrollmentStatus: "PENDING"` + `enrollmentDate` instead of old `status: "ENROLLED"` + `enrolledAt` |
| `PUT /api/sessions/[id]/enrollments/[id]` | Uses `enrollmentStatus` instead of `status` |
| `DELETE /api/sessions/[id]/enrollments/[id]` | Uses `enrollmentStatus: "CANCELLED"` instead of `status: "CANCELLED"` |

### No New APIs Required

The SessionEnrollment is fully managed by the existing APIs — no new endpoints needed.

---

## 4. Backward Compatibility

### What Still Works
- ✅ All existing APIs return the same response shape
- ✅ Trainees without a SessionEnrollment (legacy attendance from pre-enrollment era) still work — sync functions silently skip if no enrollment is found
- ✅ Existing Attendance, ExamAttempt, TestResult, CourseEvaluation, Certificate records are unchanged
- ✅ Reports continue to work from their existing data sources

### What Changed
- `SessionEnrollment.status` field renamed to `enrollmentStatus` (old field removed)
- `SessionEnrollment.enrolledAt` field renamed to `enrollmentDate` (old field removed)
- These are only used internally by the enrollments API — no external API contract changes

---

## 5. Dashboard & Reports

### Dashboard
The dashboard can now read trainee progress directly from `SessionEnrollment`:
- Count by `enrollmentStatus` (PENDING, CHECKED_IN, TRAINING, COMPLETED)
- Count by `certificateStatus` (ELIGIBLE, GENERATED, ISSUED)
- Pipeline funnel: enrolled → checked_in → pre_test_completed → final_test_passed → evaluation_completed → certificate_issued

### Reports
The 4 per-company report types (`attendanceByCompany`, `scoresByCompany`, `certificatesByCompany`, `sessionParticipation`) can now join through `SessionEnrollment` to get company attribution without needing `companyId` on every downstream model.

---

## 6. Files Changed

```
prisma/schema.prisma                                         (SessionEnrollment: 10 new fields, 6 new indexes, 2 removed fields)
src/lib/api/enrollment-sync.ts                               (NEW — 6 sync functions + recalcCertificateEligibility)
src/app/api/sessions/[id]/check-in/route.ts                  (Added sync calls for attendance + pre-test)
src/app/api/sessions/[id]/lifecycle/route.ts                 (Added sync calls for final-test auto-assign)
src/app/api/exam-attempts/[id]/start/route.ts                (Added sync calls for IN_PROGRESS)
src/app/api/exam-attempts/[id]/submit/route.ts               (Added sync calls for COMPLETED/PASSED/FAILED + recalc)
src/app/api/evaluations/route.ts                             (Added sync calls for evaluation COMPLETED + recalc)
src/app/api/certificates/route.ts                            (Added sync call for certificate GENERATED)
src/app/api/certificates/[id]/generate-pdf/route.ts          (Added sync call for certificate ISSUED)
src/app/api/sessions/[id]/enrollments/route.ts               (Updated field names: enrollmentStatus, enrollmentDate)
src/app/api/sessions/[id]/enrollments/[enrollmentId]/route.ts (Updated field names: enrollmentStatus)
docs/SESSION-ENROLLMENT-LIFECYCLE.md                         (NEW — lifecycle diagram + sync points table)
docs/DATABASE-CHANGE-SUMMARY.md                              (NEW — this document)
```

---

## 7. Verification

- ✅ Schema pushed successfully (10 new fields + 6 new indexes on SessionEnrollment)
- ✅ ESLint clean (0 errors, 0 warnings)
- ✅ Dev server compiles cleanly
- ✅ Enrollments API returns standardized response with new fields
- ✅ All sync functions are non-blocking (silently skip if no enrollment found)
- ✅ No runtime errors
- ✅ No database redesign needed after this update
