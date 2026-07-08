# TrainFlow TMS — Backup & Restore Guide

**Version:** 1.0 RC1  
**Date:** 2026-07-09  

---

## 1. Backup Strategy

### What to Back Up

| Component | Priority | Frequency | Retention |
|-----------|----------|-----------|-----------|
| Database (PostgreSQL) | CRITICAL | Daily (automated) | 30 days |
| Environment variables (.env) | CRITICAL | On change | Indefinite |
| Prisma schema (prisma/schema.prisma) | HIGH | On change (git) | Indefinite (git history) |
| Seed script (scripts/seed.ts) | MEDIUM | On change (git) | Indefinite (git history) |
| Uploaded files (future) | MEDIUM | Daily | 90 days |
| Report exports (temporary) | LOW | Not needed | N/A (regeneratable) |

---

## 2. Database Backup

### PostgreSQL (Production)

#### Automated Daily Backup (cron)

```bash
#!/bin/bash
# /opt/trainflow/backup.sh

BACKUP_DIR="/opt/trainflow/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/trainflow_$DATE.sql.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Export database (compressed)
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

# Keep only last 30 days
find $BACKUP_DIR -name "trainflow_*.sql.gz" -mtime +30 -delete

echo "Backup created: $BACKUP_FILE"
```

```bash
# Add to crontab (daily at 2am):
0 2 * * * DATABASE_URL="postgresql://..." /opt/trainflow/backup.sh >> /var/log/trainflow-backup.log 2>&1
```

#### Manual Backup

```bash
# Full database dump (compressed)
pg_dump "postgresql://user:pass@localhost:5432/trainflow" | gzip > trainflow_backup_$(date +%Y%m%d).sql.gz

# Schema only (for reference)
pg_dump --schema-only "postgresql://user:pass@localhost:5432/trainflow" > trainflow_schema.sql

# Data only (for migration)
pg_dump --data-only "postgresql://user:pass@localhost:5432/trainflow" > trainflow_data.sql
```

### SQLite (Development)

```bash
# Simple file copy
cp db/custom.db db/custom_backup_$(date +%Y%m%d).db

# Using sqlite3 CLI
sqlite3 db/custom.db ".backup db/custom_backup.db"
```

---

## 3. Database Restore

### PostgreSQL (Production)

```bash
# 1. Stop the application
systemctl stop trainflow

# 2. Drop and recreate database (CAUTION: destroys current data)
dropdb trainflow
createdb trainflow

# 3. Restore from backup
gunzip -c /opt/trainflow/backups/trainflow_20260709_020000.sql.gz | psql "postgresql://user:pass@localhost:5432/trainflow"

# 4. Verify restore
psql "postgresql://user:pass@localhost:5432/trainflow" -c "SELECT COUNT(*) FROM \"User\";"
psql "postgresql://user:pass@localhost:5432/trainflow" -c "SELECT COUNT(*) FROM \"AuditLog\";"

# 5. Restart application
systemctl start trainflow
```

### SQLite (Development)

```bash
# 1. Stop dev server

# 2. Replace database file
cp db/custom_backup_20260709.db db/custom.db

# 3. Restart dev server
```

---

## 4. Fresh Installation from Schema

### When to Use
- New environment setup
- Complete database rebuild
- Testing from zero

### Steps

```bash
# 1. Ensure schema is pushed
bun run db:push

# 2. Run seed (creates: languages, roles, permissions, settings, schedules, Super Admin)
bun run db:seed

# 3. Verify
# - Login as admin@trainflow.io / ChangeMeInProduction!2024
# - Dashboard should show all KPIs = 0 (no business data)
# - Sidebar should show 18 operational modules (19 for Super Admin with Settings)
# - Audit log should show LOGIN entry
```

---

## 5. Prisma Schema Export

The complete Prisma schema is at: `prisma/schema.prisma` (1,139 lines, 33 models)

### Export for Reference

```bash
# Copy schema to docs
cp prisma/schema.prisma docs/SCHEMA_EXPORT.prisma

# Generate migration SQL (for manual review)
bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > docs/migration.sql
```

---

## 6. Environment Variables Backup

### What to Back Up
```env
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
SUPER_ADMIN_EMAIL="..."
SUPER_ADMIN_PASSWORD="..."
SCHEDULER_SECRET="..."
NODE_ENV="production"
```

### How to Back Up
```bash
# Copy .env to secure storage
cp .env /secure/backup/trainflow_env_$(date +%Y%m%d).env

# Or export to a secrets manager (AWS Secrets Manager, Azure Key Vault, etc.)
```

---

## 7. Disaster Recovery

### Scenario: Complete Server Loss

1. **Provision new server** with Node.js/Bun + PostgreSQL
2. **Restore .env** from secure backup
3. **Clone repository**: `git clone <repo-url>`
4. **Install dependencies**: `bun install`
5. **Restore database**: `gunzip -c backup.sql.gz | psql $DATABASE_URL`
6. **Build**: `bun run build`
7. **Start**: `bun run start`
8. **Verify**: Login + check audit log + run scheduler tick

### Recovery Time Objective (RTO)
- With automated backups: **< 1 hour**
- Without automated backups: **< 4 hours** (if schema + seed available)

### Recovery Point Objective (RPO)
- With daily backups: **< 24 hours** (max 1 day data loss)
- With hourly backups: **< 1 hour**

---

## 8. Verification After Restore

```bash
# 1. Check application is running
curl https://your-domain.com/api/auth/me
# Expected: {"success":false,"error":"Unauthorized"}

# 2. Login as Super Admin
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourcompany.com","password":"your-password"}'
# Expected: {"success":true,"data":{"user":...}}

# 3. Check dashboard
curl https://your-domain.com/api/dashboard \
  -H "Cookie: tf_session=your-token"
# Expected: {"success":true,"data":{"kpis":...}}

# 4. Check audit log has historical entries
curl "https://your-domain.com/api/audit-log?pageSize=5" \
  -H "Cookie: tf_session=your-token"
# Expected: Historical audit entries

# 5. Run scheduler tick
curl -X POST https://your-domain.com/api/report-scheduler/tick \
  -H "Authorization: Bearer your-scheduler-secret"
# Expected: {"success":true,"data":{"success":true,...}}
```

---

## 9. Backup Schedule Template

| Day | Time | Action | Script |
|-----|------|--------|--------|
| Daily | 02:00 | Full database backup | `backup.sh` |
| Daily | 02:30 | Verify backup integrity | `pg_restore --list backup.sql.gz` |
| Weekly | 03:00 | Test restore on staging | `restore_test.sh` |
| Monthly | 01:00 | Review retention policy | Manual |
| On change | — | Back up .env file | Manual |
| On deploy | — | Tag git release | `git tag v1.0-rc1` |
