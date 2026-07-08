# TrainFlow TMS — Deployment Guide

**Version:** 1.0 RC1  
**Date:** 2026-07-09  

---

## 1. Prerequisites

### Production Environment
- **Runtime:** Node.js 18+ or Bun 1.0+
- **Database:** PostgreSQL 14+ (recommended) or SQLite (dev only)
- **Web Server:** Next.js standalone build (or Vercel)
- **Email:** SMTP server (for scheduled report delivery)
- **Cron:** External cron service (for scheduler tick)

### Recommended Infrastructure
- 2+ CPU cores, 4+ GB RAM
- 20+ GB disk (for PDF/Excel exports + database)
- HTTPS certificate (required for secure cookies)

---

## 2. Environment Configuration

### Required Environment Variables

```env
# Database (PostgreSQL for production)
DATABASE_URL="postgresql://user:password@localhost:5432/trainflow?schema=public"

# Security
JWT_SECRET="your-32+byte-random-secret-here"
SCHEDULER_SECRET="your-scheduler-bearer-token"

# Super Admin (seed only)
SUPER_ADMIN_EMAIL="admin@yourcompany.com"
SUPER_ADMIN_PASSWORD="StrongPassword123!"

# Environment
NODE_ENV="production"
```

### Setting Up PostgreSQL

```bash
# 1. Create database
createdb trainflow

# 2. Update DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@localhost:5432/trainflow?schema=public"

# 3. Update Prisma datasource
# Edit prisma/schema.prisma:
#   datasource db {
#     provider = "postgresql"
#     url      = env("DATABASE_URL")
#   }

# 4. Push schema
bun run db:push

# 5. Seed
bun run db:seed
```

---

## 3. Build & Deploy

### Option A: Standalone Build (Recommended)

```bash
# 1. Install dependencies
bun install

# 2. Build
bun run build

# 3. Start production server
bun run start
# Server runs on port 3000
```

### Option B: Vercel Deployment

```bash
# 1. Push to GitHub
git push origin main

# 2. Import to Vercel
# - Framework: Next.js
# - Build command: bun run build
# - Output: .next/standalone

# 3. Set environment variables in Vercel dashboard

# 4. Set up Vercel Cron for scheduler tick
# In vercel.json:
# {
#   "crons": [
#     { "path": "/api/report-scheduler/tick", "schedule": "*/10 * * * *" }
#   ]
# }
```

### Option C: Docker

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
```

```bash
docker build -t trainflow-tms .
docker run -p 3000:3000 --env-file .env trainflow-tms
```

---

## 4. Post-Deployment Configuration

### 1. Change Super Admin Password
```bash
# Login as admin@yourcompany.com with seeded password
# Go to Settings → Users → Change password
```

### 2. Configure SMTP (for email reports)
```bash
# Via Settings API (Super Admin only):
curl -X PUT https://your-domain.com/api/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: tf_session=your-jwt-token" \
  -d '{
    "settings": {
      "email.smtpHost": "smtp.gmail.com",
      "email.smtpPort": "587",
      "email.smtpUser": "noreply@yourcompany.com",
      "email.smtpFrom": "noreply@yourcompany.com"
    }
  }'
```

### 3. Configure Schedule Timing (if needed)
```bash
curl -X PUT https://your-domain.com/api/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: tf_session=your-jwt-token" \
  -d '{
    "settings": {
      "schedule.weekly.executionTime": "08:00",
      "schedule.weekly.dayOfWeek": "1",
      "schedule.monthly.executionTime": "08:00",
      "schedule.monthly.dayOfMonth": "1",
      "schedule.timezone": "Asia/Riyadh"
    }
  }'
```

### 4. Set Up External Cron (for scheduler tick)

```bash
# Add to crontab (every 10 minutes):
*/10 * * * * curl -X POST \
  -H "Authorization: Bearer your-scheduler-secret" \
  https://your-domain.com/api/report-scheduler/tick
```

### 5. Configure Report Recipients

```bash
# Update schedule with email recipients:
curl -X PUT https://your-domain.com/api/report-schedules/SCHEDULE_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: tf_session=your-jwt-token" \
  -d '{
    "recipients": ["manager@client1.com", "director@client2.com"],
    "ccRecipients": ["admin@yourcompany.com"]
  }'
```

---

## 5. Health Check

```bash
# Check if the app is running
curl https://your-domain.com/api/auth/me
# Expected: {"success":false,"error":"Unauthorized"} (means app is running)

# Check scheduler
curl -X POST \
  -H "Authorization: Bearer your-scheduler-secret" \
  https://your-domain.com/api/report-scheduler/tick
# Expected: {"success":true,"data":{"success":true,"message":"Scheduler tick completed"}}
```

---

## 6. SSL/HTTPS

### Using a Reverse Proxy (Nginx)
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Important
- Set `NODE_ENV=production` to enable `secure: true` on cookies
- HTTPS is required for secure cookies to work
- The `x-forwarded-for` header is used for IP tracking in audit logs

---

## 7. Monitoring

### Log Files
- Dev: `dev.log` (in project root)
- Production: stdout/stderr (use PM2 or systemd for log management)

### Key Metrics to Monitor
- API response times (target < 200ms for list endpoints)
- Database query performance (watch for N+1 queries)
- Scheduler tick execution time
- Email delivery success rate
- PDF generation time (large reports)

### Error Tracking
- Consider integrating Sentry or similar for production error tracking
- All API errors return `{ success: false, error: "message", code: "ERROR_CODE" }`

---

## 8. Scaling Considerations

### Database
- Add connection pooling (PgBouncer for PostgreSQL)
- Index optimization (100+ indexes already in place)
- Consider read replicas for report queries

### Application
- Horizontal scaling behind a load balancer
- Stateless API (JWT in cookies, no server-side sessions)
- File uploads: use S3/Azure Blob (not local disk)

### Scheduler
- External cron is stateless — safe to call from multiple instances
- Consider a job queue (BullMQ + Redis) for heavy report generation
