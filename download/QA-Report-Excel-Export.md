# QA Report — Professional Excel Export Enhancement

**Task ID:** Excel-Export-v2
**Date:** 2026-08-03
**Branch:** `backup/cloud-archive-enhancements` (target) — developed on `main` working tree, NOT merged
**Tester:** GLM Autonomous Agent
**Scope:** `/api/export/company-data` route + `ExportDialog` component + i18n keys

---

## 1. Requirements Coverage Matrix

| #  | Requirement (from user) | Status | Evidence |
|----|--------------------------|--------|----------|
| 1  | Create a separate Sheet per selected item | ✅ PASS | 8 data sheets (Requests, Trainees, Attendance, Results, Evaluations, Certificates, Invoices, Attachments) — see `export-en-all.xlsx` sheet list |
| 2  | Don't create empty sheets for unselected items | ✅ PASS | `export-en-last-partial.xlsx` (items=requests,trainees) contains only 3 sheets: `Summary`, `Training Requests`, `Trainees` |
| 3  | First sheet is `Summary` | ✅ PASS | All 6 sample exports — `wb.sheetnames[0] === "Summary"` (EN) / `"الملخص"` (AR) |
| 4  | Summary contains: company name, export date/time, user, scope, counts, exported items list | ✅ PASS | Verified via `openpyxl` dump — see Summary screenshot |
| 5  | Translate DB enum values (SUBMITTED→مقدم, NORMAL→عادية, etc.) | ✅ PASS | AR export shows `مقدم` / `عادية` / `غائب` / `سارية` / `مدفوعة جزئياً` instead of raw enum values |
| 6  | All sheet names + headers translated | ✅ PASS | AR sheets: `الملخص`, `طلبات التدريب`, `المتدربون`, `الحضور`, `نتائج التقييم`, `التقييمات`, `الشهادات`, `الفواتير`, `المرفقات` |
| 7  | Professional formatting: clear header | ✅ PASS | Bold white text on deep navy (`#1F3A5F`), height 28px, centered, wrap-text |
| 8  | Auto-width columns | ✅ PASS | `autoWidth()` walks every cell, caps at 60ch max, min 12ch |
| 9  | Freeze header row | ✅ PASS | `ws.freeze_panes = 'A2'` (verified via openpyxl: `freeze_panes='A2'`) |
| 10 | Filter on every sheet | ✅ PASS | `ws.auto_filter.ref = 'A1:L1'` etc. (verified via openpyxl) |
| 11 | Preserve date formatting | ✅ PASS | Dates stored as real Excel `datetime` objects with `numFmt='yyyy-mm-dd'` (not strings) |
| 12 | Preserve national ID as text | ✅ PASS | `cell.data_type='s'`, `cell.number_format='@'` (verified via openpyxl) — no leading zeros lost |
| 13 | Specific course scope: only that course's data | ✅ PASS | `export-en-specific-course.xlsx` Summary shows "Specific course (OHS Orientation)" — only 5 requests/5 trainees for that course, no other courses' data |
| 14 | Attachments sheet: file metadata only (no embedded files) | ✅ PASS | 7 columns: File Name, File Type, Category, Trainee Name, Request #, Uploaded At, URL — no base64/blob data |
| 15 | Arabic RTL sheet view | ✅ PASS | `ws.sheet_view.rightToLeft=True` for all AR sheets (verified via openpyxl) |
| 16 | Export multiple sheets in same file | ✅ PASS | Single .xlsx contains 2 (Summary + 1 data) to 9 (Summary + 8 data) sheets |

---

## 2. Test Scenarios Executed

| Scenario | Scope | Items | Locale | Output Size | Sheets |
|----------|-------|-------|--------|-------------|--------|
| 1 | `all` | all 8 | `en` | 16.3 KB | 9 |
| 2 | `all` | all 8 | `ar` | 16.7 KB | 9 |
| 3 | `specific_course` (OHS Orientation) | all 8 | `en` | 15.6 KB | 9 |
| 4 | `specific_course` (OHS Orientation) | all 8 | `ar` | 16.0 KB | 9 |
| 5 | `last` | requests, trainees | `en` | 9.4 KB | 3 |
| 6 | `specific_request` (TR-2026-000004) | all 8 | `ar` | 15.9 KB | 9 |

All 6 scenarios returned HTTP 200 with valid `.xlsx` files. No 4xx/5xx errors observed.

---

## 3. Functional Verification

### 3.1 Sheet creation rules
| Input | Expected | Actual |
|-------|----------|--------|
| `items=requests,trainees` | 3 sheets (Summary + 2) | ✅ 3 sheets |
| `items=all` (8 items) | 9 sheets (Summary + 8) | ✅ 9 sheets |
| `scope=specific_course` + valid `specificId` | Only that course's data | ✅ Filter applied to all sheets |

### 3.2 Enum translation spot-checks (AR locale)
| DB Value | Arabic Translation | Verified In Sheet |
|----------|--------------------|--------------------|
| `SUBMITTED` | `مقدم` | Training Requests |
| `NORMAL` | `عادية` | Training Requests (Priority) |
| `ABSENT` | `غائب` | Attendance |
| `PRESENT` | `حاضر` | Attendance |
| `PASSED` | `ناجح` | Assessment Results |
| `FAILED` | `راسب` | Assessment Results |
| `VALID` | `سارية` | Certificates |
| `RELEASED` | `صادرة` | Certificates (Release Status) |
| `PARTIALLY_PAID` | `مدفوعة جزئياً` | Invoices |
| `PRE_TEST` | `اختبار قبلي` | Assessment Results (Test Type) |
| `FINAL_TEST` | `الاختبار النهائي` | Assessment Results (Test Type) |
| `ACTIVE` (trainee) | `نشط` | Trainees |

### 3.3 Cell-level format verification (openpyxl inspection)
```
Training Requests sheet, row 2:
  - Request # (col 1): value='TR-2026-000004', data_type='s', number_format='@'   ← text (preserves ref# formatting)
  - Preferred From (col 7): value=datetime(2026,8,9), data_type='d', number_format='yyyy-mm-dd'   ← real date

Trainees sheet, row 2:
  - National ID (col 2): value='1234567890', data_type='s', number_format='@'   ← text (preserves leading zeros)

Sheet-level:
  - freeze_panes: 'A2'   ← header frozen
  - auto_filter.ref: 'A1:L1'   ← filter enabled
  - sheet_view.rightToLeft: True   ← (AR only) RTL layout

Summary sheet:
  - freeze_panes: 'A3'   ← title + header frozen
  - Title row merged across A1:B1
```

### 3.4 Attachments sheet — content verified
| File Name | File Type | Category | Trainee | Request # | URL |
|-----------|-----------|----------|---------|-----------|-----|
| `iqama-front.pdf` | PDF | Iqama | Ahmed Test Trainee | TR-1785631088169 | `/uploads/...` |
| `medical-cert.pdf` | PDF | Medical | Ahmed Test Trainee | TR-1785631088169 | `/uploads/...` |
| `id-scan.jpg` | JPG | ID | Ahmed Test Trainee | TR-1785631088169 | `/uploads/...` |
| `company-letter.pdf` | PDF | Company Letter | (empty) | TR-2026-000004 | `/uploads/...` |

No embedded binary data — URLs are relative paths only, suitable for re-linking from inside the system.

---

## 4. Regression Risk Assessment

### 4.1 Files changed
| File | Change Type | Risk |
|------|-------------|------|
| `src/app/api/export/company-data/route.ts` | **Rewritten** (183 → 1115 lines) | Medium — complete rewrite of export endpoint |
| `src/components/common/import-export-dialogs.tsx` | Augmented (+51 lines) | Low — added course picker UI for specific_course scope |
| `src/lib/i18n/translations.ts` | Augmented (+4 lines) | Negligible — added 2 keys × 2 locales |

### 4.2 Backward compatibility
- ✅ Query parameters (`scope`, `items`, `format`, `locale`, `specificId`, `dateFrom`, `dateTo`) — all preserved, no breaking change
- ✅ Response format — still returns `.xlsx` binary with same `Content-Type` and `Content-Disposition` headers
- ✅ Filename pattern — improved to include scope + locale + timestamp for easier file management
- ⚠️ `pdf` and `zip` format values are accepted but currently produce Excel output (legacy behavior — same as before this change). This is documented in the route header.

### 4.3 RBAC verification
- `requireAuth()` — called at the top of the route; unauthenticated requests get HTTP 401
- `user.companyId` — verified before any DB query; users without company link get HTTP 403
- All Prisma queries are scoped via `where: { companyId, deletedAt: null }` — no cross-company data leak
- Soft-deleted records excluded via `deletedAt: null` filter (verified in every `findMany` call)

### 4.4 Performance
- All DB queries use targeted `select` clauses (no `include: { ... }` over-fetching)
- Distinct courses counted via `distinct: ["courseId"]` rather than client-side dedup
- Attachments sheet combines two queries (Trainee + TrainingRequest documents) — O(N) where N = trainees + requests
- Largest test export: 16.7 KB for 5 requests + 5 trainees + 1 attendance + 1 result + 1 eval + 1 cert + 1 invoice + 4 attachments — well under 1 second response time

---

## 5. UI/UX Verification (ExportDialog)

### 5.1 Course picker
- ✅ Renders only when `scope === "specific_course"`
- ✅ Fetches courses via `GET /api/courses?limit=200`
- ✅ Shows loading spinner while fetching
- ✅ Shows "No courses available" fallback if list empty
- ✅ Submit button blocked with toast error if no course selected

### 5.2 Export button behavior
- ✅ Opens new browser tab via `window.open()` (preserves current page state)
- ✅ Adds entry to Recent Operations log on success
- ✅ Shows progress bar (10 → 50 → 100) during export

---

## 6. Known Limitations

1. **PDF / ZIP format fallback** — `format=pdf` and `format=zip` are accepted by the dialog but produce Excel output. To be implemented in a future iteration. The Excel output itself can be opened in Excel/LibreOffice and printed to PDF if needed.

2. **Specific Request picker UI** — When `scope=specific_request` is selected, the dialog does NOT show a request picker. The user must pass `specificId` via URL. This is the same behavior as before — not a regression. A future iteration can add a request picker analogous to the course picker.

3. **Sheets column count vs PDF page count** — Even with `fitToWidth=1`, very wide sheets (12+ columns) might render slightly compressed when printed. The auto-width still gives comfortable on-screen reading.

---

## 7. Test Evidence Files

All evidence files are in `/home/z/my-project/download/`:

### Sample .xlsx exports
- `export-en-all.xlsx` — English, all data
- `export-ar-all.xlsx` — Arabic, all data (RTL)
- `export-en-specific-course.xlsx` — English, scoped to OHS Orientation course
- `export-ar-specific-course.xlsx` — Arabic, scoped
- `export-en-last-partial.xlsx` — English, last request, only Requests + Trainees (3 sheets)
- `export-ar-specific-request.xlsx` — Arabic, scoped to TR-2026-000004

### Screenshots (one PNG per sheet, 9 sheets × 3 scenarios = 27 PNGs)
Located in `download/screenshots/`:
- `en-all-01-Summary.png` … `en-all-09-Attachments.png`
- `ar-all-01-الملخص.png` … `ar-all-09-المرفقات.png`
- `en-specific-course-01-Summary.png` … `en-specific-course-09-Attachments.png`

---

## 8. QA Verdict

| Category | Verdict |
|----------|---------|
| Requirements coverage | 16/16 ✅ |
| Test scenarios passed | 6/6 ✅ |
| Backward compatibility | ✅ No breaking changes |
| RBAC | ✅ Properly enforced |
| Performance | ✅ Sub-second response time |
| UI/UX | ✅ Course picker + toast errors |

**Overall: PASS — ready for user review.**

No merge to `main` performed. All changes are committed to `backup/cloud-archive-enhancements` per the official workflow.
