# TrainFlow TMS — Report Execution Flow

> **Sprint 3.5** — Scheduled Client Reports

---

## Execution Flow (Step by Step)

```
┌─────────────────────────────────────────────────────────────────┐
│ TRIGGER                                                         │
│ ┌─────────────┐  ┌─────────────┐                               │
│ │ SCHEDULED   │  │ MANUAL      │                               │
│ │ (cron tick) │  │ (Run Now)   │                               │
│ └──────┬──────┘  └──────┬──────┘                               │
└────────┼────────────────┼───────────────────────────────────────┘
         │                │
         ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Create Execution Record                                 │
│ • status = RUNNING                                              │
│ • triggerType = SCHEDULED | MANUAL                              │
│ • triggeredBy = userId (for MANUAL)                             │
│ • startedAt = now                                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Step 2: Load Template + Compute Filters                         │
│ • Get template from registry by schedule.templateCode           │
│ • Compute dynamic date range:                                   │
│   - WEEKLY → next week (Mon-Sun)                                │
│   - MONTHLY → previous month (1st - last day)                  │
│ • Merge with static filters from schedule.filters JSON          │
│ • status = GENERATING                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Step 3: Run Template Query                                      │
│ • Call template.query(effectiveFilter)                          │
│ • Returns ReportDataRow[] from production database              │
│ • Records rowCount on execution                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Step 4: Export to Requested Formats                             │
│ • Parse schedule.exportFormats JSON (e.g. ["xlsx", "pdf"])     │
│ • For each format:                                              │
│   - Call exportReport(template, format, data, filterInfo)       │
│   - Get back { buffer, mimeType, filename }                    │
│ • Store exported files metadata on execution                    │
│ • status = SENDING                                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Step 5: Send Email                                              │
│ • Parse recipients, ccRecipients, bccRecipients from schedule   │
│ • Build subject + body (or use schedule's custom subject/body)  │
│ • Attach exported files as EmailAttachment[]                    │
│ • Call sendReportEmail()                                        │
│ • Record emailStatus, emailSentAt, emailError                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────────────────────┐
│ SUCCESS              │  │ FAILURE                              │
│ status = SENT        │  │ status = FAILED                      │
│ emailStatus = SENT   │  │ emailStatus = FAILED                 │
│ emailSentAt = now    │  │ errorMessage = error                 │
│ completedAt = now    │  │ nextRetryAt = now + retryDelayMin    │
│ durationMs = elapsed │  │ completedAt = now                    │
└──────────┬───────────┘  └──────────────┬───────────────────────┘
           │                             │
           ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Update Schedule Tracking                                │
│ • lastRunAt = completedAt                                       │
│ • lastExecutionId = execution.id                                │
│ • nextRunAt = getNextRunTime(cronExpression)  (for SCHEDULED)   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Step 7: Audit Log                                               │
│ • action = CREATE                                               │
│ • entity = SETTING                                              │
│ • description = "Report execution: {name} — {rows} rows,        │
│   email {sent/failed} ({triggerType})"                          │
│ • metadata = { scheduleId, templateCode, rowCount, emailSuccess,│
│   triggerType, durationMs }                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Manual "Run Now" Flow

```
Coordinator/SuperAdmin → POST /api/report-schedules/[id]/run
  → executeReportSchedule({ scheduleId, triggerType: "MANUAL", triggeredBy: userId })
  → Same pipeline as above
  → Does NOT update nextRunAt (only scheduled runs do)
  → Returns { executionId, status, rowCount, emailSent }
```

## Retry Flow

```
Scheduler Tick → Check FAILED executions with nextRetryAt <= now
  → If attemptNumber < maxRetries:
    → Increment attemptNumber
    → Re-execute the schedule
  → If attemptNumber >= maxRetries:
    → Mark as permanent failure (nextRetryAt = null)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/report-schedules` | GET | List schedules (paginated, filterable) |
| `/api/report-schedules` | POST | Create schedule |
| `/api/report-schedules/[id]` | GET | Get schedule details |
| `/api/report-schedules/[id]` | PUT | Update schedule |
| `/api/report-schedules/[id]` | DELETE | Soft-delete schedule |
| `/api/report-schedules/[id]/run` | POST | Manual "Run Now" |
| `/api/report-executions` | GET | List execution history |
| `/api/report-executions/[id]/retry` | POST | Manually retry failed execution |
| `/api/report-scheduler/tick` | POST/GET | Scheduler tick (external cron) |
