# TrainFlow TMS — Email Delivery Design

> **Sprint 3.5** — Scheduled Client Reports

---

## 1. Overview

Email delivery sends report exports (Excel/PDF) as attachments to configurable recipient lists per schedule.

## 2. SMTP Configuration

SMTP settings are stored in the `Setting` table (category: EMAIL):

| Setting Key | Description | Default |
|-------------|-------------|---------|
| `email.smtpHost` | SMTP server host | (empty) |
| `email.smtpPort` | SMTP server port | 587 |
| `email.smtpUser` | SMTP username | (empty) |
| `email.smtpFrom` | From email address | noreply@trainflow.io |

When SMTP is not configured (dev/sandbox), emails are **simulated** (logged to console with full details).

## 3. Email Structure

```
From: noreply@trainflow.io (from Settings)
To: [recipient list from schedule]
CC: [cc recipients] (optional)
BCC: [bcc recipients] (optional)
Subject: {Schedule Name} — {Date Range} (Generated: {date})
Body:
  Dear Recipient,

  Please find attached the following report:
  Report: {schedule name}
  Template: {template name}
  Total Records: {count}
  Generated: {timestamp}

  Filters Applied:
    • From: 2026-06-01
    • To: 2026-06-30
    • Company: Saudi Build Co.
    • City: Riyadh

  Attachments:
    • GCCLAB_MONTHLY_2026-07-08.xlsx
    • GCCLAB_MONTHLY_2026-07-08.pdf

  This report was generated automatically by TrainFlow TMS.

  Best regards,
  TrainFlow TMS Reporting Engine
```

## 4. Attachment Handling

- Multiple formats supported (Excel + PDF per schedule)
- Attachments stored as Buffer in memory (not written to disk)
- File size tracked in `ReportExecution.exportedFiles` JSON

## 5. Delivery Status Tracking

| Status | Description |
|--------|-------------|
| `PENDING` | Email queued but not yet sent |
| `SENT` | Email delivered successfully |
| `FAILED` | Email delivery failed (error logged in `emailError`) |
| `SKIPPED` | No recipients configured (empty list) |

Each execution records:
- `emailStatus` — delivery status
- `emailSentAt` — timestamp of successful delivery
- `emailError` — error message on failure
- `emailRecipients` — actual recipients used

## 6. Retry Logic

1. Email send fails → `emailStatus = FAILED`
2. `nextRetryAt = now + retryDelayMin` (configurable, default 10 min)
3. Scheduler tick picks up FAILED executions with `nextRetryAt <= now`
4. Retries up to `maxRetries` (default 3)
5. After max retries → permanent failure
