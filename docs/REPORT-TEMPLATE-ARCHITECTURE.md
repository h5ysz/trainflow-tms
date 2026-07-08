# TrainFlow TMS — Report Template Architecture

> **Sprint 3.3** — Official Client Reporting Engine

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Layer                                    │
│  /api/report-templates (GET — list templates)                   │
│  /api/reports/generate   (GET — preview, POST — export)         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                  Template Registry                               │
│  TEMPLATES[] — array of ReportTemplate objects                   │
│  getTemplate(code) — lookup by code                             │
│  listTemplates() — list metadata                                │
└─────────┬────────────────────────┬──────────────────────────────┘
          │                        │
          ▼                        ▼
┌─────────────────────┐  ┌─────────────────────────────────────────┐
│  Template Query     │  │  Export Service                          │
│  (per template)     │  │  exportToExcel()  exportToPdf()          │
│  Pulls from DB      │  │  Reads column defs from template         │
│  Returns DataRow[]  │  │  Renders Excel/PDF                       │
└─────────────────────┘  └─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Production Database                           │
│  TrainingSession → Attendance → TestResult → Certificate        │
│  ↑ with Company, Course, Trainer, Exam data                     │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Core Interfaces

### ReportTemplate
```typescript
interface ReportTemplate {
  code: string;                    // unique ID (e.g. "GCCLAB_MONTHLY")
  name: string;                    // display name
  nameAr: string;                  // Arabic name
  description: string;
  supportedFormats: ExportFormat[]; // ["xlsx", "pdf"]
  columns: ReportColumn[];         // column definitions
  groupByCompany?: boolean;        // group rows by company
  title?: string;                  // report title
  query: (filter: ReportFilter) => Promise<ReportDataRow[]>;
}
```

### ReportColumn
```typescript
interface ReportColumn {
  key: string;     // field key in the data row
  header: string;  // column header in the export
  width?: number;  // Excel column width
  format?: "text" | "date" | "datetime" | "number" | "percentage" | "boolean";
}
```

### ReportFilter
```typescript
interface ReportFilter {
  month?: string;       // "2026-07"
  dateFrom?: string;    // ISO date
  dateTo?: string;      // ISO date
  companyId?: string;
  trainerId?: string;
  courseId?: string;
  region?: string;
  city?: string;
  client?: string;      // alias for companyId
}
```

## 3. Template Registration

New client templates are added by appending to the `TEMPLATES` array in `src/lib/reports/template-registry.ts`:

```typescript
export const TEMPLATES: ReportTemplate[] = [
  { code: "GCCLAB_MONTHLY", ... },
  // Add new templates here:
  { code: "CLIENT_X_QUARTERLY", ... },
  { code: "CLIENT_Y_SUMMARY", ... },
];
```

No business logic changes needed — the export service reads column definitions from the template automatically.

## 4. GCCLAB Monthly Template

The first template reproduces the existing GCCLAB monthly Excel report with 20 columns:

| # | Column | Source |
|---|--------|--------|
| 1 | Trainee Name | Attendance.traineeName |
| 2 | National ID / Iqama | Attendance.traineeIdNational |
| 3 | Company | Company.name (via Attendance.companyId) |
| 4 | Company Ref | Company.refNumber |
| 5 | City | Session.city (fallback: Company.city) |
| 6 | Region | Session.region (fallback: Company.region) |
| 7 | Course | Course.title |
| 8 | Course Code | Course.code |
| 9 | Session | Session.refNumber |
| 10 | Session Date | Session.startDate |
| 11 | Trainer | Trainer.fullName |
| 12 | Attendance | Attendance.status |
| 13 | Check-in Time | Attendance.checkInAt |
| 14 | Pre-Test Score | TestResult.scorePercent (PRE_TEST) |
| 15 | Final Test Score | TestResult.scorePercent (FINAL_TEST) |
| 16 | Exam Result | "PASSED" / "FAILED" (from TestResult.passed) |
| 17 | Certificate No. | Certificate.refNumber |
| 18 | Certificate Status | Certificate.status |
| 19 | Issue Date | Certificate.issuedAt |
| 20 | Expiry Date | Certificate.validUntil |

### Query Strategy
1. Fetch sessions matching date/filter criteria
2. Eager-load: course, trainer, attendance, certificates
3. Batch-fetch exam results (TestResult) for all matching sessions
4. Batch-fetch company info for all company IDs
5. Build one row per attendance record
6. Join certificate + exam data by (traineeName + traineeIdNational)

### Grouping
When `groupByCompany = true`, Excel rows are grouped by company with:
- Company header row (teal background, bold)
- Data rows under each company
- Spacer row between companies
- Summary row at the bottom with total count

## 5. Filter Support

| Filter | Implementation |
|--------|---------------|
| Monthly | `filter.month = "2026-07"` → date range from 1st to last day of month |
| Date Range | `filter.dateFrom` + `filter.dateTo` → applied to `Session.startDate` |
| Client / Company | `filter.companyId` or `filter.client` → applied to `Attendance.companyId` |
| Trainer | `filter.trainerId` → applied to `Session.trainerId` |
| Course | `filter.courseId` → applied to `Session.courseId` |
| Region | `filter.region` → applied to `Session.region` |
| City | `filter.city` → applied to `Session.city` |

Contractors are automatically scoped to their own company.
