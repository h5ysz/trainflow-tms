# TrainFlow TMS — Scheduler Architecture

> **Sprint 3.5** — Scheduled Client Reports

---

## 1. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│  External Cron / Vercel Cron / System Timer                       │
│  (calls /api/report-scheduler/tick every 5-10 min)               │
└──────────────────────────┬────────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────────┐
│  Scheduler Tick Endpoint                                          │
│  /api/report-scheduler/tick (POST, Bearer token auth)             │
└──────────────────────────┬────────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────────┐
│  Scheduler Service (scheduler.ts)                                 │
│  • cronMatches() — evaluate cron expression                       │
│  • getNextRunTime() — compute next run                            │
│  • getDueSchedules() — find schedules where nextRunAt <= now      │
│  • buildCronExpression() — from type + time + day params         │
└──────────┬──────────────────────────────┬─────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐    ┌─────────────────────────────────────────┐
│ Due Schedules       │    │ Failed Executions (retry)               │
│ (nextRunAt <= now)  │    │ (status=FAILED, nextRetryAt <= now)     │
└────────┬────────────┘    └──────────┬──────────────────────────────┘
         │                            │
         ▼                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  Execution Engine (execution-engine.ts)                           │
│  1. Create ReportExecution record (status=RUNNING)                │
│  2. Load template + compute dynamic filters                       │
│  3. Run template query (from production DB)                       │
│  4. Export to Excel/PDF                                           │
│  5. Send email with attachments                                   │
│  6. Update execution (status=SENT/FAILED)                         │
│  7. Update schedule (lastRunAt, nextRunAt)                        │
│  8. Audit log                                                     │
└───────────────────────────────────────────────────────────────────┘
```

## 2. Schedule Types

| Type | Cron Pattern | Example |
|------|-------------|---------|
| WEEKLY | `M H * * DOW` | `0 9 * * 4` = Every Thursday 9:00 AM |
| MONTHLY | `M H DOM * *` | `0 9 1 * *` = 1st of every month 9:00 AM |
| DAILY | `M H * * *` | `0 9 * * *` = Every day 9:00 AM |
| CUSTOM | Any 5-field cron | `*/30 * * * *` = Every 30 minutes |

## 3. Dynamic Filter Computation

| Schedule Type | Date Range |
|--------------|------------|
| WEEKLY | Next week (Monday → Sunday) |
| MONTHLY | Previous month (1st → last day) |
| DAILY | Today |
| CUSTOM | Uses static filters from schedule config |

## 4. Retry Logic

1. If execution fails → `status = FAILED`, `nextRetryAt = now + retryDelayMin`
2. Scheduler tick checks for FAILED executions with `nextRetryAt <= now`
3. If `attemptNumber < maxRetries` → retry (increment attempt)
4. If `attemptNumber >= maxRetries` → permanent failure (no more retries)

## 5. Default Schedules (Seeded)

### Schedule 1: Weekly Scheduled Training Report
- **Cron:** `0 9 * * 4` (Every Thursday at 9:00 AM)
- **Filters:** Next week (dynamic), Client, Region, City
- **Formats:** Excel + PDF
- **Purpose:** Send all training sessions scheduled for the following week

### Schedule 2: Monthly Training Completion Report
- **Cron:** `0 9 1 * *` (1st of every month at 9:00 AM)
- **Filters:** Previous month (dynamic)
- **Formats:** Excel + PDF
- **Purpose:** Send completed training results (attendance, pass/fail, certificates, trainers, companies, cities, regions)
