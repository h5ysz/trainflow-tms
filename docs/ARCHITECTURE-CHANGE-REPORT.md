# TrainFlow TMS — Architecture Change Report

> **Document ID:** ACR-001  
> **Date:** 2026-07-08  
> **Trigger:** Multi-Company Training Session Architecture  
> **Status:** COMPLETED  

---

## 1. Executive Summary

This report documents the architecture change required to support **multi-company Training Sessions** — where a single Training Session can contain trainees from multiple companies, while preserving each trainee's original company throughout the training execution pipeline (attendance, exams, evaluation, certificate).

Prior to this change, Training Sessions were strictly single-company: the session inherited its company from the Training Request, and all trainees in the session were required to belong to that same company. This prevented scenarios where multiple contractor companies send trainees to a shared training session.

---

## 2. Problem Statement

### Before (Single-Company Sessions)

```
Company A → Training Request → Training Session → [Trainees from Company A only]
```

- `TrainingRequest.companyId` (required, single) → `TrainingSession.requestId` → `TrainingRequestCourse` → `TrainingRequestCourseTrainee` → `Trainee.companyId`
- Business rule enforced: all trainees in a request must belong to the request's company (`TRAINEE_COMPANY_MISMATCH` error)
- Certificates used `session.request.companyId` for the certificate's company
- No mechanism to enroll trainees from different companies into the same session

### Limitation

When two companies (e.g., "Saudi Build Co." and "Gulf Petro Services") both need the same "Basic Safety Training" course, they had to submit separate training requests and schedule separate sessions — even if the trainer, venue, and time were identical. This was inefficient and did not reflect real-world training operations where companies share sessions.

---

## 3. Architecture Changes

### 3.1 New Models

#### `SessionEnrollment` (NEW)

Direct many-to-many junction between `TrainingSession` and `Trainee`, with a snapshot of the trainee's company.

```prisma
model SessionEnrollment {
  id              String   @id @default(uuid())
  sessionId       String
  traineeId       String
  companyId       String   // trainee's ORIGINAL company — preserved
  enrolledAt      DateTime @default(now())
  enrolledBy      String?
  status          String   @default("ENROLLED")
  // ... audit columns
}
```

**Key design decision:** The `companyId` field stores a **snapshot** of the trainee's company at enrollment time. This ensures that even if a trainee is later moved to a different company (e.g., company restructuring), the enrollment record preserves the original company context.

#### `SessionCompany` (NEW)

Tracks which companies have trainees enrolled in a session, with a count per company. This is a denormalized summary table for efficient reporting.

```prisma
model SessionCompany {
  id              String   @id @default(uuid())
  sessionId       String
  companyId       String
  traineeCount    Int      @default(0)
  // ... audit columns
}
```

### 3.2 Updated Models

#### `TrainingSession`

Added new relations:
```prisma
enrollments     SessionEnrollment[]
sessionCompanies SessionCompany[]
```

No new direct fields on `TrainingSession` — the company context is now **implicit** through the enrolled trainees' companies, not a single `companyId` on the session.

#### `Trainee`

Added new relation:
```prisma
sessionEnrollments SessionEnrollment[]
```

#### `Company`

Added new relations:
```prisma
sessionEnrollments SessionEnrollment[]
sessionCompanies   SessionCompany[]
```

### 3.3 Business Logic Changes

#### QR Check-in (`/api/sessions/[id]/check-in`)

**Before:** Accepted `companyId` from the request body (defaults to session's company).

**After:** Looks up the trainee by `nationalId` and uses the **trainee's** `companyId` from the `Trainee` record. This preserves the trainee's original company even if they're from a different company than the session's owning company.

```typescript
// MULTI-COMPANY: Look up the trainee to get their ORIGINAL company
const trainee = await db.trainee.findFirst({
  where: { nationalId: body.traineeIdNational, deletedAt: null },
  include: { company: { select: { id: true, name: true } } },
});
if (trainee) {
  traineeCompanyId = trainee.companyId;
  traineeCompanyName = trainee.company?.name ?? null;
}
```

#### Certificate Generation (`/api/certificates`)

**Before:** Used `session.request.companyId` for the certificate's company.

**After:** Looks up the trainee's company from the `Attendance` record and uses **that** company. Falls back to `session.request.companyId` only if no attendance record exists.

```typescript
// MULTI-COMPANY: Use the TRAINEE's company from the attendance record
const attendanceForCompany = await db.attendance.findFirst({
  where: { sessionId, traineeName: { equals: traineeName }, deletedAt: null },
  select: { companyId: true },
});
const certificateCompanyId = attendanceForCompany?.companyId ?? session.request?.companyId ?? null;
```

#### Bulk Certificate Generation (`/api/sessions/[id]/generate-certificates`)

Same change as above — uses `trainee.companyId` (from the attendance record) instead of `session.request.companyId`.

#### New API: Session Enrollment (`/api/sessions/[id]/enrollments`)

- `GET` — list all enrollments with trainee + company info, plus a summary of participating companies
- `POST` — enroll one or more trainees (from ANY company) into a session. Validates capacity, prevents duplicates, auto-creates/updates `SessionCompany` records.
- `PUT /api/sessions/[id]/enrollments/[enrollmentId]` — update enrollment status
- `DELETE /api/sessions/[id]/enrollments/[enrollmentId]` — remove enrollment (soft delete + decrement SessionCompany count)

### 3.4 What Did NOT Change

- **TrainingRequest** still has a single `companyId` — requests are still submitted by one company. The multi-company change is at the **Session** level, not the Request level.
- **TrainingRequestCourseTrainee** still enforces `TRAINEE_COMPANY_MISMATCH` — trainees in a request must belong to the request's company. This is intentional: a request is a company-specific document.
- **Trainee.companyId** — unchanged. Every trainee always belongs to exactly one company. This is the "original company" that is preserved.
- **Attendance.companyId** — already existed as a snapshot field. Now properly populated from the trainee's company rather than the request's company.

---

## 4. Data Flow (After Change)

### Multi-Company Session Example

```
Training Session: SES-000001 (Basic Safety Training)
  ├── SessionEnrollment: Trainee A (Company X) ← companyId = X
  ├── SessionEnrollment: Trainee B (Company X) ← companyId = X
  ├── SessionEnrollment: Trainee C (Company Y) ← companyId = Y
  └── SessionEnrollment: Trainee D (Company Z) ← companyId = Z

SessionCompany records:
  ├── SessionCompany: sessionId=SES-000001, companyId=X, traineeCount=2
  ├── SessionCompany: sessionId=SES-000001, companyId=Y, traineeCount=1
  └── SessionCompany: sessionId=SES-000001, companyId=Z, traineeCount=1

Attendance records (after QR check-in):
  ├── Attendance: traineeName="A", companyId=X (from Trainee record)
  ├── Attendance: traineeName="B", companyId=X
  ├── Attendance: traineeName="C", companyId=Y
  └── Attendance: traineeName="D", companyId=Z

Certificates (after all 3 conditions met):
  ├── Certificate: traineeName="A", companyId=X (from Attendance)
  ├── Certificate: traineeName="B", companyId=X
  ├── Certificate: traineeName="C", companyId=Y
  └── Certificate: traineeName="D", companyId=Z
```

### Pipeline with Company Preservation

```
1. Coordinator creates Session (no company constraint)
2. Coordinator enrolls trainees from Company X, Y, Z via /enrollments
   → SessionEnrollment records created with each trainee's companyId
   → SessionCompany records created/updated with counts per company
3. QR Check-in: trainee scans QR
   → System looks up Trainee by nationalId
   → Gets trainee's companyId from Trainee record
   → Creates Attendance with trainee's companyId (NOT session's company)
4. Pre-Test auto-assigned (randomized, per-trainee)
5. Session lifecycle: STARTED → BREAK → RESUMED → COMPLETED
6. Final-Test auto-assigned (randomized, per-trainee)
7. Course Evaluation submitted (with suggestions)
8. Certificate eligibility check (3 conditions)
9. Certificate generated with trainee's companyId (from Attendance)
10. Certificate PDF generated with QR verification URL
```

---

## 5. Impact Assessment

### Models Affected
| Model | Change Type | Impact |
|-------|------------|--------|
| `SessionEnrollment` | NEW | Multi-company enrollment junction |
| `SessionCompany` | NEW | Company participation summary per session |
| `TrainingSession` | Relations added | `enrollments`, `sessionCompanies` |
| `Trainee` | Relations added | `sessionEnrollments` |
| `Company` | Relations added | `sessionEnrollments`, `sessionCompanies` |
| `Attendance` | Logic change | `companyId` now from Trainee, not from Request |
| `Certificate` | Logic change | `companyId` now from Attendance, not from Request |

### APIs Affected
| API | Change Type | Impact |
|-----|------------|--------|
| `POST /api/sessions/[id]/enrollments` | NEW | Multi-company enrollment (batch support) |
| `GET /api/sessions/[id]/enrollments` | NEW | List enrollments + company summary |
| `PUT/DELETE /api/sessions/[id]/enrollments/[id]` | NEW | Manage individual enrollment |
| `POST /api/sessions/[id]/check-in` | Modified | Uses trainee's company (not session's) |
| `POST /api/certificates` | Modified | Uses trainee's company (from attendance) |
| `POST /api/sessions/[id]/generate-certificates` | Modified | Uses trainee's company (from attendance) |

### What's NOT Affected
- Training Request workflow (still single-company per request)
- Trainee creation (still one company per trainee)
- RBAC (Coordinators/Super Admin can enroll any trainee; Contractors see only their company's trainees)
- Audit log (all new enrollment actions logged with bilingual descriptions)
- Ref numbers (no new ref number types needed)

---

## 6. Migration Path

### For Existing Data
- Existing sessions that were created from a single-company request continue to work unchanged
- No data migration needed — the `SessionEnrollment` table starts empty
- Existing `Attendance` records retain their `companyId` as-is
- Existing `Certificate` records retain their `companyId` as-is

### For New Sessions
- Coordinators can now enroll trainees from any company via the new `/enrollments` API
- The old path (auto-enrollment from `TrainingRequestCourseTrainee` when generating sessions from a request) still works for single-company sessions
- Both paths can coexist — a session can have trainees from the request AND additional trainees enrolled directly

---

## 7. Testing Checklist

- [x] Schema pushed successfully (2 new models + 3 relation updates)
- [x] ESLint clean (0 errors, 0 warnings)
- [x] Dev server compiles cleanly
- [x] `POST /api/sessions/[id]/enrollments` accepts trainees from different companies
- [x] `POST /api/sessions/[id]/check-in` uses trainee's company (not session's)
- [x] `POST /api/certificates` uses trainee's company (from attendance)
- [x] `POST /api/sessions/[id]/generate-certificates` uses trainee's company
- [x] ER diagram generated (Mermaid format in `docs/ER-DIAGRAM.md`)
- [x] Architecture Change Report generated (this document)

---

## 8. Files Changed

```
prisma/schema.prisma                                    (2 new models: SessionEnrollment, SessionCompany + 3 relation updates)
src/app/api/sessions/[id]/enrollments/route.ts          (NEW — multi-company enrollment list + create)
src/app/api/sessions/[id]/enrollments/[enrollmentId]/route.ts (NEW — update + delete enrollment)
src/app/api/sessions/[id]/check-in/route.ts             (Modified — uses trainee's company)
src/app/api/certificates/route.ts                       (Modified — uses trainee's company from attendance)
src/app/api/sessions/[id]/generate-certificates/route.ts (Modified — uses trainee's company)
docs/ER-DIAGRAM.md                                      (NEW — full ER diagram in Mermaid)
docs/ARCHITECTURE-CHANGE-REPORT.md                      (NEW — this document)
```

---

## 9. Conclusion

The multi-company Training Session architecture is now **COMPLETE**. A single Training Session can contain trainees from multiple companies, and every trainee's original company is preserved throughout the entire pipeline — from enrollment, through attendance and exams, to the final certificate.

This change is backward-compatible: existing single-company sessions continue to work, and the new multi-company enrollment is an additional capability that coordinators can use when needed.
