# TrainFlow TMS — CHANGELOG

All notable changes to the TrainFlow Training Management System are documented in this file.

---

## Version 1.0 RC1 — 2026-07-09

### Sprint 1 — Project Structure & UI (Phase 1)
- **Initialized** Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui project
- **Designed** Microsoft 365-inspired UI with teal primary color, light sidebar, dark mode support
- **Built** bilingual (Arabic RTL / English LTR) i18n system with 600+ translation keys
- **Created** login page with 4-role selector (Super Admin, Coordinator, Trainer, Contractor)
- **Built** AppShell: responsive sidebar (grouped nav), topbar (search, language toggle, theme toggle, notifications, profile dropdown), command palette (Ctrl+K)
- **Built** 18 module pages with DataTable, FormDialog, EmptyState, StatusBadge, RoleGuard shared components
- **Designed** Prisma schema with 14 models: User, Company, CompanyContact, Trainer, TrainerQualification, Course, TrainingRequest, TrainingSession, Attendance, Question, TestResult, CourseEvaluation, Certificate, Notification, AuditLog, Setting
- **Implemented** Zustand store with persistence (auth, locale, theme, routing, sidebar, command palette)

### Sprint 2 — Training Planning Engine
- **Added** Trainee model with TRA-000001 ref numbers + duplicate National ID prevention
- **Added** `preferredContact` field to CompanyContact (PHONE | MOBILE | EMAIL | WHATSAPP)
- **Implemented** multi-course Training Requests: TrainingRequestCourse + TrainingRequestCourseTrainee junction models
- **Enforced** business rules: min 10 / max 20 trainees per course; approval blocked if violated (APPROVAL_VALIDATION_FAILED)
- **Validated** trainees must belong to same company as request (TRAINEE_COMPANY_MISMATCH)
- **Added** Session planning fields: city, region, venue, shift (Morning/Evening), durationHours (default 6), capacity
- **Built** TrainerCertification model linking trainers to courses they're certified to teach
- **Implemented** trainer assignment validation: role check (Coordinator/SuperAdmin), certification check (NOT_CERTIFIED), scheduling conflict prevention (SCHEDULE_CONFLICT)
- **Added** 9 new Dashboard KPIs: pending requests, under-review, approved, scheduled sessions, today's sessions, available trainers, trainer conflicts, companies, trainees
- **Added** 3 new report types: trainees, conflicts, todaySessions
- **Updated** seed: added trainees module to RBAC + permissions

### Sprint 3 — Training Execution Module
- **Implemented** QR attendance: time-window activation (qrActiveFrom/qrActiveTo), device tracking (userAgent, IP, fingerprint), duplicate prevention, CheckInAttempt logging
- **Built** exam engine with question randomization: Fisher-Yates shuffle for question order + answer choice order; per-trainee exam versions (questionSet JSON snapshot)
- **Auto-assigned** Pre-Test on QR check-in (if course.hasPreTest)
- **Added** Session lifecycle tracking: NOT_STARTED → STARTED → ON_BREAK → COMPLETED with SessionLifecycleEvent log
- **Auto-assigned** Final Test on session COMPLETED (if course.hasFinalTest)
- **Locked** Final Test until session lifecycleStatus = COMPLETED
- **Enforced** maxAttempts (default 1) on exam start
- **Added** `suggestions` field to CourseEvaluation
- **Implemented** certificate 3-condition eligibility: attendance PRESENT + final test PASSED + evaluation COMPLETED
- **Built** PDF certificate generation with pdfkit (A4 landscape, teal branding, QR verification URL)
- **Added** bulk certificate generation endpoint
- **Created** exam-engine.ts, certificate-eligibility.ts service modules

### Sprint 3 — Multi-Company Architecture
- **Added** SessionEnrollment model: multi-company session enrollment with companyId snapshot
- **Added** SessionCompany model: denormalized company participation summary per session
- **Updated** QR check-in to use trainee's company (from Trainee record, not session's)
- **Updated** certificate generation to use trainee's company (from Attendance, not Request)
- **Added** `companyId` to ExamAttempt, TestResult, CourseEvaluation for per-company reporting
- **Updated** byCompany report to count requests + enrollments + certificates per company
- **Added** 4 per-company report types: attendanceByCompany, scoresByCompany, certificatesByCompany, sessionParticipation
- **Generated** ER diagram (Mermaid) + Architecture Change Report

### Sprint 3.1 — Final Enrollment Architecture
- **Extended** SessionEnrollment with 10 workflow status fields:
  - enrollmentStatus (7 states: PENDING → CONFIRMED → CHECKED_IN → TRAINING → COMPLETED | CANCELLED | NO_SHOW)
  - attendanceStatus (4: NOT_STARTED | PRESENT | LATE | ABSENT)
  - preTestStatus (4: NOT_REQUIRED | PENDING | IN_PROGRESS | COMPLETED)
  - finalTestStatus (5: NOT_REQUIRED | PENDING | IN_PROGRESS | PASSED | FAILED)
  - evaluationStatus (3: NOT_REQUIRED | PENDING | COMPLETED)
  - certificateStatus (4: NOT_ELIGIBLE | ELIGIBLE | GENERATED | ISSUED)
  - enrolledBy, enrollmentDate, completedDate, notes, attendanceId
- **Built** enrollment-sync.ts: 6 sync functions + recalcCertificateEligibility()
- **Wired** sync calls into: check-in, exam start, exam submit, evaluation POST, certificate POST, PDF generation
- **Generated** SessionEnrollment Lifecycle Diagram + Database Change Summary

### Sprint 3.3 — Official Client Reporting Engine
- **Built** template-based report architecture: ReportTemplate interface with columns, query function, groupByCompany
- **Implemented** GCCLAB Monthly Report template: 20 columns (trainee, company, city, region, course, session, trainer, attendance, exam, certificate, issue/expiry dates)
- **Built** export service: Excel (.xlsx) via exceljs with company grouping + frozen headers; PDF via pdfkit with zebra striping + page breaks
- **Added** API endpoints: /api/report-templates (list), /api/reports/generate (preview + export)
- **Supported** filters: monthly, date range, client/company, trainer, course, region, city

### Sprint 3.5 — Scheduled Client Reports
- **Added** ReportSchedule model: cron expression, executionTime, timezone, dayOfWeek, dayOfMonth, filters, recipients, exportFormats, retry config
- **Added** ReportExecution model: status tracking (PENDING → RUNNING → GENERATING → SENDING → SENT | FAILED | RETRYING), email delivery status, retry tracking, error logging
- **Built** scheduler service: cronMatches(), getNextRunTime(), buildCronExpression(), getDueSchedules(), syncScheduleFromSettings()
- **Built** email delivery service: SMTP from Settings, simulated send in dev, retry logic
- **Built** execution engine: full pipeline (load template → compute dynamic filters → run query → export → email → log → audit)
- **Seeded** 2 default schedules: Weekly (Thursday 9am, next week filter) + Monthly (1st 9am, previous month filter)
- **Added** API endpoints: CRUD schedules, list executions, manual Run Now, retry, scheduler tick
- **Made** all schedule timing configurable via Settings (7 schedule.* keys)

### Sprint 4 — System Verification & Stabilization
- **Verified** all 20 modules end-to-end (27 API endpoints tested, 0 failures)
- **Fixed** 8 bugs:
  1. CRITICAL: Exam maxAttempts not enforced
  2. MEDIUM: NO_SHOW not handled for absent trainees
  3. MEDIUM: Empty recipients blocked schedule creation
  4. LOW: No email format validation on recipients
  5. LOW: Dead GET_PUBLIC function in settings
  6. CRITICAL: Requests API used `session` (singular) instead of `sessions` (plural)
  7. HIGH: byCompany report used renamed field `enrolledAt` → `enrollmentDate`
  8. MEDIUM: Retry execution created duplicate records
- **Generated** System Verification Report, Bug Fix Report, Production Readiness Report

### Sprint 4 — RBAC Update
- **Updated** Coordinator and Trainer to have equivalent operational permissions (18 modules each)
- **Limited** Super Admin exclusives to: Settings, Users & Roles, platform configuration
- **Removed** trainer-specific data scoping from sessions, attendance, dashboard, reports APIs
- **Updated** seed role descriptions

---

## Architecture Summary (v1.0 RC1)

| Metric | Count |
|--------|-------|
| Database models | 33 |
| API endpoints | 65 |
| Frontend routes | 21 |
| Translation keys | 1,173 (EN + AR) |
| System settings | 28 |
| Report templates | 1 (GCCLAB_MONTHLY, extensible) |
| Report types | 15 |
| Scheduled reports | 2 (Weekly + Monthly, Settings-driven) |
| Audit action types | 13 |
| Audit entity types | 11 |
| Database indexes | 100+ |
| Schema lines | 1,139 |
