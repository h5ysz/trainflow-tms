# TrainFlow TMS — Release Notes

**Version:** 1.0 RC1 (Release Candidate 1)  
**Date:** 2026-07-09  
**Codename:** Baseline  

---

## Overview

TrainFlow TMS (Training Management System) is an enterprise-grade, bilingual (Arabic RTL / English LTR) SaaS platform for managing corporate safety training — from training request to certificate issuance. This is the first Release Candidate, establishing the official development baseline.

## Key Features

### Training Lifecycle
- Multi-company training requests with 9-state workflow (Draft → Submitted → Under Review → Approved → Scheduled → In Progress → Completed | Cancelled | Rejected)
- Multi-course requests with per-course trainee lists (min 10 / max 20 per course)
- Multi-company training sessions with SessionEnrollment as the central workflow entity
- Session lifecycle tracking (Started → Break → Resumed → Completed)

### Training Execution
- QR code attendance with time-window activation + device tracking
- Auto-assigned Pre-Test with randomized questions + answer choices (per-trainee exam versions)
- Auto-assigned Final Test (locked until session completion) with configurable pass score
- Course evaluation with 5 rating dimensions + suggestions
- Certificate generation with 3-condition eligibility (attendance + final test + evaluation)
- PDF certificate with QR verification URL

### Reporting
- Template-based reporting engine (GCCLAB Monthly template with 20 columns)
- Excel (.xlsx) + PDF export with company grouping
- 15 report types including per-company analytics
- Scheduled reports (Weekly Thursday + Monthly 1st) with Settings-driven timing
- Email delivery with attachments + retry logic

### Platform
- 4-role RBAC (Super Admin, Coordinator, Trainer, Contractor)
- Coordinator and Trainer have equivalent operational permissions
- Super Admin exclusive: Settings, Users, platform configuration
- Bilingual (Arabic RTL / English LTR) with 600+ translation keys
- Microsoft 365-inspired UI with dark mode
- Full audit trail (13 action types, 11 entity types, bilingual descriptions)
- Soft delete across all modules
- UUID primary keys on all 33 models
- Standardized API response ({ success, data, meta })

## System Statistics

| Metric | Value |
|--------|-------|
| Database models | 33 |
| API endpoints | 65 |
| Frontend routes | 21 |
| Translation keys | 1,173 |
| System settings | 28 |
| Report types | 15 |
| Scheduled reports | 2 |
| Audit actions | 13 |
| Reference number types | 8 (TR-, CERT-, EXAM-, TRN-, COM-, CRS-, SES-, TRA-) |

## Verified Modules (20/20)

1. Authentication & RBAC ✅
2. Companies ✅
3. Contacts ✅
4. Trainers ✅
5. Trainees ✅
6. Training Requests ✅
7. Courses ✅
8. Training Sessions ✅
9. Session Enrollment ✅
10. QR Attendance ✅
11. Pre-Test ✅
12. Final Test ✅
13. Course Evaluation ✅
14. Certificates ✅
15. Dashboard KPIs ✅
16. Reports ✅
17. Scheduled Reports ✅
18. Email Delivery ✅
19. Audit Log ✅
20. Settings ✅

## Known Limitations

- PDF report export limited to 500 rows (full data in Excel)
- Email delivery simulated in dev/sandbox (SMTP not configured)
- No rate limiting on login endpoint (recommendation for production)
- No CSRF protection (recommendation for production)
- SQLite database (switch to PostgreSQL for production)

## What's Next

After RC1 baseline is approved:
- Production deployment (PostgreSQL, HTTPS, SMTP, external cron)
- AI-assisted exam generation (schema ready)
- Multi-tenant isolation (schema ready)
- Mobile app (public certificate verification API ready)
- Real-time WebSocket notifications (infrastructure ready)
