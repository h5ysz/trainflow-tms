# TrainFlow TMS — Export Service Design

> **Sprint 3.3** — Official Client Reporting Engine

---

## 1. Design Principles

1. **Format-agnostic** — The export service reads column definitions from the template, not from format-specific code
2. **Pluggable** — New formats (CSV, JSON, XML) can be added by implementing the `exportTo*()` function
3. **Template-driven** — Layout (columns, widths, grouping, title) comes from the template, not hardcoded
4. **Production data** — All data comes directly from the Prisma database, no intermediate caches

## 2. Export Formats

### Excel (.xlsx) — via `exceljs`

**Features:**
- Professional teal branding (header row, title)
- Company grouping with subtotals (when `groupByCompany = true`)
- Column widths from template definition
- Cell formatting per column type (date, datetime, percentage, text)
- Frozen header row (always visible when scrolling)
- Filter info + generation timestamp in header
- Summary row with total count

**Layout:**
```
Row 1: [Template Title — merged, teal, 14pt bold]
Row 2: [Filter info — merged, grey italic, 9pt]
Row 3: [Generated: timestamp — merged, grey italic, 9pt]
Row 4: [empty spacer]
Row 5: [Column headers — teal background, white text, bold]
Row 6+: [Data rows — 10pt, hair borders]
        [Company group header — when groupByCompany]
        [Company data rows]
        [spacer]
Last:  [Total Trainees: N — bold]
```

### PDF — via `pdfkit`

**Features:**
- A4 landscape orientation
- Teal header row with column titles
- Alternating row backgrounds (zebra striping)
- Automatic page breaks with header repeat
- 500-row limit for PDF (full data available in Excel)
- Summary footer with total count

**Layout:**
```
[Template Title — centered, teal, 14pt]
[Filter info — centered, grey, 8pt]
[Generated: timestamp — centered, grey, 8pt]
─────────────────────────────────────────
[Column headers — teal background, white, 6pt]
[Data row 1 — 6pt]
[Data row 2 — 6pt, light grey background]
...
[Page break → header repeats]
...
─────────────────────────────────────────
[Total Trainees: N — bold, 8pt]
```

## 3. Export Service Interface

```typescript
// Main entry point — called by the API
async function exportReport(
  template: ReportTemplate,
  format: "xlsx" | "pdf",
  data: ReportDataRow[],
  filterInfo?: Record<string, string>
): Promise<ExportResult>

// Individual format exporters (can be called directly)
async function exportToExcel(template, data, filterInfo?): Promise<ExportResult>
async function exportToPdf(template, data, filterInfo?): Promise<ExportResult>
```

### ExportResult
```typescript
interface ExportResult {
  buffer: Buffer;      // file content as a Node Buffer
  mimeType: string;    // MIME type for the HTTP response
  filename: string;    // suggested download filename
}
```

## 4. Adding New Export Formats

To add a new format (e.g., CSV):

1. Implement the export function:
```typescript
// src/lib/reports/export-service.ts
export async function exportToCsv(
  template: ReportTemplate,
  data: ReportDataRow[]
): Promise<ExportResult> {
  // Build CSV from template.columns + data
  // Return { buffer, mimeType: "text/csv", filename }
}
```

2. Add to the `exportReport()` switch:
```typescript
export async function exportReport(template, format, data, filterInfo) {
  switch (format) {
    case "xlsx": return exportToExcel(template, data, filterInfo);
    case "pdf":  return exportToPdf(template, data, filterInfo);
    case "csv":  return exportToCsv(template, data);  // NEW
  }
}
```

3. Add `"csv"` to the template's `supportedFormats` array.

## 5. API Endpoints

### List Templates
```
GET /api/report-templates
→ { success: true, data: [{ code, name, nameAr, description, supportedFormats, columns, ... }] }
```

### Preview Report (JSON)
```
GET /api/reports/generate?template=GCCLAB_MONTHLY&month=2026-07&companyId=xxx
→ { success: true, data: { template, templateName, columns, rowCount, rows, totalRows, filter } }
```

### Generate + Download Export
```
POST /api/reports/generate
Content-Type: application/json
Body: { template: "GCCLAB_MONTHLY", format: "xlsx", filter: { month: "2026-07" } }
→ Binary file download (Excel or PDF)
```

### Supported Filters (query params or POST body)
| Parameter | Example | Description |
|-----------|---------|-------------|
| `month` | `2026-07` | Filter by month (1st to last day) |
| `dateFrom` | `2026-01-01` | Start date |
| `dateTo` | `2026-12-31` | End date |
| `companyId` | UUID | Filter by company |
| `client` | UUID | Alias for companyId |
| `trainerId` | UUID | Filter by trainer |
| `courseId` | UUID | Filter by course |
| `city` | `Riyadh` | Filter by city |
| `region` | `Riyadh Region` | Filter by region |

## 6. Audit Logging

Every report generation is logged:
```
Action: CREATE
Entity: SETTING
Description: "Generated report: GCCLAB Monthly Report (XLSX) — 42 rows"
Metadata: { templateCode, format, rowCount, filter }
```

## 7. Security

- All endpoints require authentication (JWT cookie)
- Contractors are auto-scoped to their own company (cannot see other companies' data)
- Trainers can only see their own sessions' data
- Coordinators + Super Admins have full access
