# TrainFlow TMS — System Documentation

**Version:** 1.0 RC1  
**Date:** 2026-07-09  

---

## 1. System Architecture

### Technology Stack
- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui
- **Backend:** Next.js API Routes (serverless) + Prisma ORM 6
- **Database:** SQLite (dev) / PostgreSQL (production-ready)
- **Auth:** JWT via jose + httpOnly cookies, PBKDF2 password hashing
- **State:** Zustand (client) + TanStack Query (server, available)
- **Export:** exceljs (Excel) + pdfkit (PDF)
- **Icons:** Lucide React
- **Charts:** Recharts

### Project Structure
```
prisma/schema.prisma                    # 33 Prisma models (1,139 lines)
scripts/seed.ts                         # Clean seed (no fake business data)
src/
  app/
    api/                                # 65 API route files
      auth/                             # login, logout, me
      companies/                        # CRUD + [id]
      company-contacts/                 # CRUD + [id]
      trainers/                         # CRUD + [id]
      trainer-qualifications/           # CRUD + [id]
      trainer-certifications/           # CRUD + [id]
      trainees/                         # CRUD + [id]
      courses/                          # CRUD + [id]
      requests/                         # CRUD + [id] + courses/[courseId]/trainees
      sessions/                         # CRUD + [id] + check-in + lifecycle + enrollments + assign-trainer + generate-certificates + qr + qr-activate + generate-from-request
      attendance/                       # CRUD + [id]
      questions/                        # CRUD + [id]
      exam-attempts/                    # list + [id] + start + submit
      test-results/                     # list + create
      evaluations/                      # list + create
      certificates/                     # CRUD + [id] + generate-pdf + verify
      dashboard/                        # aggregated KPIs
      reports/                          # [type] + generate
      report-templates/                 # list
      report-schedules/                 # CRUD + [id] + run
      report-executions/                # list + [id]/retry
      report-scheduler/                 # tick
      notifications/                    # CRUD + [id]
      audit-log/                        # list
      settings/                         # GET + PUT
      users/                            # CRUD + [id]
      languages/                        # list
      roles/                            # list
    globals.css                         # M365 design tokens
    layout.tsx                          # Root layout
    page.tsx                            # Entry point (login or app shell)
  lib/
    api/                                # response.ts, query.ts, ref-number.ts, client.ts, hooks.ts, trainer-assignment.ts, request-validation.ts, exam-engine.ts, certificate-eligibility.ts, enrollment-sync.ts
    auth/                               # jwt.ts, api.ts, audit.ts, permissions.ts
    reports/                            # template-registry.ts, export-service.ts, scheduler.ts, email-service.ts, execution-engine.ts
    store/                              # app-store.ts (Zustand)
    i18n/                               # translations.ts, context.tsx
    db.ts                               # Prisma client
    utils.ts                            # Utility functions
  components/
    ui/                                 # 50+ shadcn/ui components
    layout/                             # app-shell.tsx, sidebar.tsx, topbar.tsx, command-palette.tsx
    auth/                               # login-form.tsx
    common/                             # page-header.tsx, data-table.tsx, empty-state.tsx, status-badge.tsx, role-guard.tsx, form-dialog.tsx
  routes/                               # 21 frontend route components
    router.tsx                          # Route dispatcher
    dashboard.tsx, companies.tsx, company-contacts.tsx, trainers.tsx, trainer-qualifications.tsx, trainees.tsx, courses.tsx, training-requests.tsx, training-sessions.tsx, scheduling.tsx, attendance.tsx, qr-code.tsx, pre-test.tsx, final-test.tsx, course-evaluation.tsx, certificates.tsx, reports.tsx, notifications.tsx, audit-log.tsx, settings-page.tsx
docs/                                   # All documentation
```

### Architecture Layers
```
┌─────────────────────────────────────────────────┐
│  Frontend (Next.js App Router)                   │
│  React 19 + Tailwind 4 + shadcn/ui               │
│  Bilingual (EN/AR RTL/LTR)                       │
│  21 route components                             │
└────────────────────┬────────────────────────────┘
                     │ fetch (credentials: same-origin)
┌────────────────────▼────────────────────────────┐
│  API Layer (65 endpoints)                        │
│  Standardized response: { success, data, meta }  │
│  RBAC: withModuleAction(module, action)          │
│  Pagination + search + filter + sort             │
│  Soft delete: whereWithSoftDelete()              │
└────────────────────┬────────────────────────────┘
                     │ Prisma Client
┌────────────────────▼────────────────────────────┐
│  Business Logic Layer                            │
│  exam-engine.ts (randomization + grading)        │
│  certificate-eligibility.ts (3-condition check)  │
│  enrollment-sync.ts (6 sync functions)           │
│  trainer-assignment.ts (cert + conflict check)   │
│  request-validation.ts (min/max trainees)        │
│  ref-number.ts (atomic counter)                  │
│  scheduler.ts (cron evaluation)                  │
│  execution-engine.ts (report pipeline)           │
│  export-service.ts (Excel + PDF)                 │
│  email-service.ts (SMTP delivery)                │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Database (Prisma ORM → SQLite/PostgreSQL)       │
│  33 models, UUID PKs, soft delete, audit columns │
│  100+ indexes                                    │
└─────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### Models (33 total)

| # | Model | Purpose | Ref Number |
|---|-------|---------|------------|
| 1 | Tenant | Multi-tenant support (future) | — |
| 2 | Language | EN/AR language config | — |
| 3 | Role | System roles (4) | — |
| 4 | Permission | Module×action permissions (65) | — |
| 5 | User | Authenticated users | — |
| 6 | Setting | System configuration (28 keys) | — |
| 7 | RefNumberCounter | Atomic sequence generator | — |
| 8 | Company | Contractor companies | COM-000001 |
| 9 | Trainee | Trainees (per company) | TRA-000001 |
| 10 | CompanyContact | Company contact persons | — |
| 11 | Trainer | Trainer profiles | TRN-000001 |
| 12 | TrainerQualification | Trainer certifications | — |
| 13 | TrainerCertification | Trainer→Course certification link | — |
| 14 | Course | Course catalog | CRS-000001 |
| 15 | Question | Question bank | — |
| 16 | TrainingRequest | Training requests (9-state workflow) | TR-YYYY-000001 |
| 17 | TrainingRequestCourse | Multi-course junction | — |
| 18 | TrainingRequestCourseTrainee | Per-course trainee lists | — |
| 19 | SessionEnrollment | Central workflow entity (10 status fields) | — |
| 20 | SessionCompany | Company participation per session | — |
| 21 | TrainingSession | Scheduled training sessions | SES-000001 |
| 22 | SessionLifecycleEvent | STARTED/BREAK/RESUMED/COMPLETED | — |
| 23 | Attendance | QR check-in records | — |
| 24 | CheckInAttempt | QR scan log (success + failure) | — |
| 25 | TestResult | Exam results (backwards compat) | EXAM-YYYY-000001 |
| 26 | ExamAttempt | Randomized per-trainee exam versions | EXAM-YYYY-000001 |
| 27 | CourseEvaluation | Trainee feedback (5 ratings + suggestions) | — |
| 28 | Certificate | Training certificates | CERT-YYYY-000001 |
| 29 | CertificateVerification | Public QR verification log | — |
| 30 | Notification | In-app notifications | — |
| 31 | AuditLog | System activity trail | — |
| 32 | ReportSchedule | Scheduled report config | — |
| 33 | ReportExecution | Report run history + delivery status | — |

### Audit Columns (all business entities)
Every business model includes: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt`

### Soft Delete
All list queries apply `whereWithSoftDelete()` — excludes `deletedAt != null` records by default. Admins can use `?includeDeleted=true`.

---

## 3. ER Diagram

See: `docs/ER-DIAGRAM.md` (Mermaid format, covers all 33 models)

Key relationships:
- Company → Trainee (1:N, preserves original company)
- TrainingSession → SessionEnrollment → Trainee (multi-company)
- SessionEnrollment (central workflow: 6 status fields, auto-synced)
- Attendance → ExamAttempt → TestResult (pipeline chain)
- Certificate ← (eligibility: attendance + final test + evaluation)

---

## 4. API Documentation

### Standardized Response
```json
// Success
{ "success": true, "data": T, "meta": { "page": 1, "pageSize": 10, "total": 42, "totalPages": 5 } }

// Error
{ "success": false, "error": "Not found", "code": "NOT_FOUND" }
```

### API Endpoints (65 routes)

#### Auth (3)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /api/auth/login | Login (email+password or role) | Public |
| POST | /api/auth/logout | Logout + clear cookie | Authenticated |
| GET | /api/auth/me | Current user info | Authenticated |

#### Companies (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET | /api/companies | List (paginated, searchable) | companies.view |
| POST | /api/companies | Create (auto COM- ref) | companies.create |
| GET/PUT/DELETE | /api/companies/[id] | Get/update/soft-delete | companies.view/edit/delete |

#### Company Contacts (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET | /api/company-contacts | List | company-contacts.view |
| POST | /api/company-contacts | Create (with preferredContact) | company-contacts.create |
| GET/PUT/DELETE | /api/company-contacts/[id] | CRUD | company-contacts.* |

#### Trainers (3) + Qualifications (3) + Certifications (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/trainers | List/Create (TRN- ref) | trainers.* |
| GET/PUT/DELETE | /api/trainers/[id] | CRUD | trainers.* |
| GET/POST | /api/trainer-qualifications | List/Create | trainer-qualifications.* |
| GET/PUT/DELETE | /api/trainer-qualifications/[id] | CRUD | trainer-qualifications.* |
| GET/POST | /api/trainer-certifications | List/Create (trainer↔course) | trainer-qualifications.* |
| GET/PUT/DELETE | /api/trainer-certifications/[id] | CRUD | trainer-qualifications.* |

#### Trainees (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/trainees | List/Create (TRA- ref, dup National ID check) | trainees.* |
| GET/PUT/DELETE | /api/trainees/[id] | CRUD | trainees.* |

#### Courses (3) + Questions (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/courses | List/Create (CRS- ref) | courses.* |
| GET/PUT/DELETE | /api/courses/[id] | CRUD | courses.* |
| GET/POST | /api/questions | List/Create (question bank) | pre-test.* |
| GET/PUT/DELETE | /api/questions/[id] | CRUD | pre-test.* |

#### Training Requests (3) + Multi-course (3)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/requests | List/Create (TR- ref, 9-state workflow) | requests.* |
| GET/PUT/DELETE | /api/requests/[id] | CRUD (workflow transitions, approval validation) | requests.* |
| GET/POST/PUT/DELETE | /api/requests/[id]/courses/[courseId] | Add/update/remove course in request | requests.edit |
| GET/POST/DELETE | /api/requests/[id]/courses/[courseId]/trainees | Manage trainees in course | requests.edit |

#### Training Sessions (3) + Sub-routes (8)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/sessions | List/Create (SES- ref, trainer validation) | sessions.* |
| GET/PUT/DELETE | /api/sessions/[id] | CRUD | sessions.* |
| POST | /api/sessions/[id]/check-in | QR attendance (time window + device tracking) | attendance.create |
| POST/GET | /api/sessions/[id]/lifecycle | STARTED/BREAK/RESUMED/COMPLETED | sessions.edit |
| GET/POST | /api/sessions/[id]/enrollments | Multi-company enrollment | sessions.view/edit |
| PUT/DELETE | /api/sessions/[id]/enrollments/[enrollmentId] | Update/remove enrollment | sessions.edit |
| POST/GET | /api/sessions/[id]/assign-trainer | Assign trainer (cert + conflict check) | sessions.edit |
| POST | /api/sessions/[id]/generate-certificates | Bulk certificate generation | certificates.create |
| POST | /api/sessions/[id]/generate-from-request | Auto-generate sessions from approved request | sessions.create |
| POST | /api/sessions/[id]/qr | Regenerate QR token | qr-code.create |
| POST | /api/sessions/[id]/qr-activate | Set QR time window | qr-code.create |

#### Exams (4)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET | /api/exam-attempts | List exam attempts | pre-test.view |
| GET | /api/exam-attempts/[id] | Get attempt details | pre-test.view |
| POST | /api/exam-attempts/[id]/start | Start exam (resolve randomized questions) | pre-test.view |
| POST | /api/exam-attempts/[id]/submit | Submit + grade (auto-sync SessionEnrollment) | pre-test.view |
| GET/POST | /api/test-results | List/Create test results | pre-test.view/create |

#### Evaluation (2)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/evaluations | List/Create (5 ratings + suggestions) | evaluation.view/create |

#### Certificates (4)
| Method | Path | Description | RBAC |
|--------|------|-------------|------|
| GET/POST | /api/certificates | List/Issue (3-condition eligibility, CERT- ref) | certificates.* |
| GET/PUT/DELETE | /api/certificates/[id] | CRUD | certificates.* |
| POST | /api/certificates/[id]/generate-pdf | Generate PDF with QR verification | certificates.edit |
| GET | /api/certificates/verify | Public QR verification (no auth) | Public |

#### Dashboard (1)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /api/dashboard | 17 KPIs + charts + upcoming sessions + activity | Authenticated |

#### Reports (3)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /api/reports/[type] | 15 report types (summary, byCompany, scores, etc.) | reports.view |
| GET | /api/reports/generate | Preview report data (JSON) | Authenticated |
| POST | /api/reports/generate | Generate + download (Excel/PDF) | Authenticated |

#### Scheduled Reports (6)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET/POST | /api/report-schedules | List/Create schedules | Coordinator+ |
| GET/PUT/DELETE | /api/report-schedules/[id] | CRUD | Coordinator+ |
| POST | /api/report-schedules/[id]/run | Manual "Run Now" | Coordinator+ |
| GET | /api/report-executions | List execution history | Coordinator+ |
| POST | /api/report-executions/[id]/retry | Retry failed execution | Coordinator+ |
| POST/GET | /api/report-scheduler/tick | Scheduler tick (Bearer token) | Token auth |
| GET | /api/report-templates | List available templates | Authenticated |

#### Other (8)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET/POST/DELETE | /api/notifications | List/Create/Mark-read | Authenticated |
| PATCH/DELETE | /api/notifications/[id] | Update/delete | Authenticated |
| GET | /api/audit-log | List (Super Admin/Coordinator) | audit-log.view |
| GET/PUT | /api/settings | Get/update settings (Super Admin) | SUPER_ADMIN |
| GET/POST | /api/users | List/Create users (Super Admin) | SUPER_ADMIN |
| GET/PUT/DELETE | /api/users/[id] | CRUD users | SUPER_ADMIN |
| GET | /api/languages | List languages | Public |
| GET | /api/roles | List roles | Authenticated |

---

## 5. Permission Matrix

### Module Visibility

| Module | Super Admin | Coordinator | Trainer | Contractor |
|--------|:-----------:|:-----------:|:-------:|:----------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Companies | ✅ | ✅ | ✅ | ❌ |
| Company Contacts | ✅ | ✅ | ✅ | ❌ |
| Trainers | ✅ | ✅ | ✅ | ❌ |
| Trainer Qualifications | ✅ | ✅ | ✅ | ❌ |
| Trainees | ✅ | ✅ | ✅ | ✅ (own) |
| Courses | ✅ | ✅ | ✅ | ❌ |
| Training Requests | ✅ | ✅ | ✅ | ✅ (own) |
| Training Sessions | ✅ | ✅ | ✅ | ❌ |
| Scheduling | ✅ | ✅ | ✅ | ❌ |
| Attendance | ✅ | ✅ | ✅ | ❌ |
| QR Code | ✅ | ✅ | ✅ | ❌ |
| Pre-Test | ✅ | ✅ | ✅ | ❌ |
| Final Test | ✅ | ✅ | ✅ | ❌ |
| Course Evaluation | ✅ | ✅ (view) | ✅ (view) | ❌ |
| Certificates | ✅ | ✅ | ✅ | ✅ (view) |
| Reports | ✅ | ✅ (view) | ✅ (view) | ❌ |
| Notifications | ✅ | ✅ (view) | ✅ (view) | ✅ (view) |
| Audit Log | ✅ | ✅ (view) | ✅ (view) | ❌ |
| **Settings** | ✅ **Exclusive** | ❌ | ❌ | ❌ |

### Action Permissions (Coordinator = Trainer)

| Module | View | Create | Edit | Delete |
|--------|:----:|:------:|:----:|:------:|
| Companies | ✅ | ✅ | ✅ | ✅ |
| Company Contacts | ✅ | ✅ | ✅ | ✅ |
| Trainers | ✅ | ✅ | ✅ | ✅ |
| Trainer Qualifications | ✅ | ✅ | ✅ | ✅ |
| Trainees | ✅ | ✅ | ✅ | ✅ |
| Courses | ✅ | ✅ | ✅ | ✅ |
| Requests | ✅ | ✅ | ✅ | ✅ |
| Sessions | ✅ | ✅ | ✅ | ✅ |
| Scheduling | ✅ | ✅ | ✅ | ✅ |
| Attendance | ✅ | ✅ | ✅ | ✅ |
| QR Code | ✅ | ✅ | ✅ | ✅ |
| Pre-Test | ✅ | ✅ | ✅ | ✅ |
| Final Test | ✅ | ✅ | ✅ | ✅ |
| Evaluation | ✅ | — | — | — |
| Certificates | ✅ | ✅ | ✅ | ✅ |
| Reports | ✅ | — | — | — |
| Notifications | ✅ | — | — | — |
| Audit Log | ✅ | — | — | — |

---

## 6. Module List (20 modules)

| # | Module | Icon | Group | Description |
|---|--------|------|-------|-------------|
| 1 | Dashboard | LayoutDashboard | Overview | 17 KPIs + charts + upcoming sessions + activity feed |
| 2 | Companies | Building2 | Training | Contractor company management (COM- ref) |
| 3 | Company Contacts | Contact | Training | Contact persons with preferredContact |
| 4 | Trainers | Users | Training | Trainer profiles (TRN- ref) |
| 5 | Trainer Qualifications | Award | Training | Trainer certifications + credentials |
| 6 | Trainees | UserSquare | Training | Trainee management (TRA- ref, dup National ID prevention) |
| 7 | Training Courses | BookOpen | Training | Course catalog + Question Bank (CRS- ref) |
| 8 | Training Requests | ClipboardList | Training | 9-state workflow, multi-course (TR- ref) |
| 9 | Training Sessions | CalendarDays | Training | Session planning + lifecycle (SES- ref) |
| 10 | Scheduling | CalendarRange | Training | Month/week/day calendar view |
| 11 | Attendance | UserCheck | Training | QR check-in + manual attendance |
| 12 | QR Code | QrCode | Training | QR generation + time-window activation |
| 13 | Pre-Test | FilePen | Assessments | Randomized pre-test exams |
| 14 | Final Test | FileCheck2 | Assessments | Randomized final exams (locked until session complete) |
| 15 | Course Evaluation | Star | Assessments | 5-rating + suggestions feedback |
| 16 | Certificates | BadgeCheck | Compliance | 3-condition eligibility + PDF generation (CERT- ref) |
| 17 | Reports | BarChart3 | Compliance | 15 report types + Excel/PDF export |
| 18 | Audit Log | ScrollText | Compliance | 13 action types, bilingual |
| 19 | Notifications | Bell | System | In-app notifications |
| 20 | Settings | Settings | System | Super Admin exclusive (28 settings) |

---

## 7. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `file:./db/custom.db` | Prisma database URL (SQLite or PostgreSQL) |
| `JWT_SECRET` | Yes | (dev fallback) | 32+ byte secret for JWT signing |
| `SUPER_ADMIN_EMAIL` | No | `admin@trainflow.io` | Super Admin email (seed) |
| `SUPER_ADMIN_PASSWORD` | No | `ChangeMeInProduction!2024` | Super Admin password (seed) |
| `SCHEDULER_SECRET` | No | `trainflow-scheduler-secret` | Bearer token for scheduler tick endpoint |
| `NODE_ENV` | No | `development` | Environment (production enables secure cookies) |

---

## 8. Installation Guide

### Prerequisites
- Node.js 18+ / Bun
- SQLite (dev) or PostgreSQL (production)

### Steps
```bash
# 1. Install dependencies
bun install

# 2. Set environment variables
cp .env.example .env  # edit as needed

# 3. Push database schema
bun run db:push

# 4. Run seed (creates: languages, roles, permissions, settings, schedules, Super Admin)
bun run db:seed

# 5. Start dev server
bun run dev

# 6. Open http://localhost:3000
# Login: admin@trainflow.io / ChangeMeInProduction!2024
# Or click a role card for demo access
```

### Build for Production
```bash
bun run build
bun run start
```

---

## 9. Reference Numbers

| Entity | Format | Reset | Example |
|--------|--------|-------|---------|
| Training Request | TR-YYYY-000001 | Yearly | TR-2026-000001 |
| Certificate | CERT-YYYY-000001 | Yearly | CERT-2026-000001 |
| Exam | EXAM-YYYY-000001 | Yearly | EXAM-2026-000001 |
| Trainer | TRN-000001 | Continuous | TRN-000001 |
| Company | COM-000001 | Continuous | COM-000001 |
| Course | CRS-000001 | Continuous | CRS-000001 |
| Session | SES-000001 | Continuous | SES-000001 |
| Trainee | TRA-000001 | Continuous | TRA-000001 |

---

## 10. SessionEnrollment Lifecycle

### Status Fields (6 per enrollment)

| Field | Values |
|-------|--------|
| enrollmentStatus | PENDING → CONFIRMED → CHECKED_IN → TRAINING → COMPLETED \| CANCELLED \| NO_SHOW |
| attendanceStatus | NOT_STARTED → PRESENT \| LATE \| ABSENT |
| preTestStatus | NOT_REQUIRED \| PENDING → IN_PROGRESS → COMPLETED |
| finalTestStatus | NOT_REQUIRED \| PENDING → IN_PROGRESS → PASSED \| FAILED |
| evaluationStatus | NOT_REQUIRED \| PENDING → COMPLETED |
| certificateStatus | NOT_ELIGIBLE → ELIGIBLE → GENERATED → ISSUED |

### Auto-Sync Points

| Trigger | Sync Function | Status Updated |
|---------|--------------|----------------|
| QR check-in | syncAttendanceCheckedIn() | attendanceStatus=PRESENT, enrollmentStatus=CHECKED_IN |
| Pre-Test assigned | syncPreTestStatus(PENDING) | preTestStatus=PENDING |
| Pre-Test started | syncPreTestStatus(IN_PROGRESS) | preTestStatus=IN_PROGRESS, enrollmentStatus=TRAINING |
| Pre-Test submitted | syncPreTestStatus(COMPLETED) | preTestStatus=COMPLETED |
| Final-Test assigned | syncFinalTestStatus(PENDING) | finalTestStatus=PENDING |
| Final-Test started | syncFinalTestStatus(IN_PROGRESS) | finalTestStatus=IN_PROGRESS |
| Final-Test graded | syncFinalTestStatus(PASSED/FAILED) | finalTestStatus=PASSED/FAILED |
| Evaluation submitted | syncEvaluationStatus(COMPLETED) | evaluationStatus=COMPLETED |
| After exam/eval | recalcCertificateEligibility() | certificateStatus=ELIGIBLE/NOT_ELIGIBLE |
| Certificate generated | syncCertificateStatus(GENERATED) | certificateStatus=GENERATED, enrollmentStatus=COMPLETED |
| Certificate PDF issued | syncCertificateStatus(ISSUED) | certificateStatus=ISSUED |
| Session COMPLETED | (bulk) | absent enrollments → NO_SHOW, ABSENT |
