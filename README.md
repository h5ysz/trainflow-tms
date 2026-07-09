# TrainFlow TMS

A multi-tenant training management system: training requests, course scheduling, trainer
qualifications, QR-based attendance, online exams, certificate generation and verification,
and scheduled report delivery.

Built with Next.js 16 (App Router, standalone output), React 19, Prisma, Tailwind v4, and shadcn/ui.

## Quick start

```bash
bun install          # or: npm install
cp .env.example .env # then fill in the values below
bun run db:generate  # generate the Prisma client
bun run dev          # http://localhost:3000
```

The repository ships with a seeded SQLite database at `db/custom.db`, so the app runs
immediately after install. To rebuild it from scratch:

```bash
bun run db:push      # apply the schema
bun run db:seed      # roles, permissions, settings, super admin
bun run db:seed:demo # optional: demo companies, courses, sessions
```

> [!WARNING]
> The committed `db/custom.db` contains a super-admin account seeded with the default
> password from `scripts/seed.ts` (`ChangeMeInProduction!2024`). It is demo data and is
> fine for local development, but **never deploy this file as-is**. Provision a fresh
> database and set `SUPER_ADMIN_PASSWORD` before seeding any environment that is
> reachable from a network.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Prisma connection string. SQLite for dev, PostgreSQL for production. |
| `JWT_SECRET` | yes | Session signing key, 32+ bytes. The app refuses to boot without it. |
| `SCHEDULER_SECRET` | yes | Bearer token guarding `POST /api/report-scheduler/tick`. |
| `SUPER_ADMIN_EMAIL` | seed only | Super-admin address created by `db:seed`. |
| `SUPER_ADMIN_PASSWORD` | seed only | Super-admin password created by `db:seed`. |

See [.env.example](.env.example) for the full annotated list.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Development server on port 3000. |
| `bun run build` | Production build (`output: "standalone"`). |
| `bun run start` | Serve the standalone build. |
| `bun run lint` | ESLint across the project. |
| `bun run db:push` / `db:migrate` / `db:reset` | Prisma schema management. |
| `bun run db:seed` / `db:seed:demo` | Seed baseline data / demo dataset. |

## Deployment

The build emits a self-contained server at `.next/standalone/server.js`. Production
requires PostgreSQL, HTTPS (secure cookies), an SMTP server for report delivery, and an
external cron hitting the scheduler tick endpoint.

Full instructions, including the reverse-proxy [Caddyfile](Caddyfile), are in
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## Documentation

- [SYSTEM_DOCUMENTATION.md](SYSTEM_DOCUMENTATION.md) — feature and module reference
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — production deployment
- [BACKUP_RESTORE_GUIDE.md](BACKUP_RESTORE_GUIDE.md) — backup and restore procedures
- [CHANGELOG.md](CHANGELOG.md) — release history
- [docs/](docs/) — architecture notes, ER diagram, design records

## Notes

`next.config.ts` sets `typescript.ignoreBuildErrors: true`. Application code under `src/`
typechecks clean; the remaining errors are confined to `scripts/seed-demo.ts` and
`examples/`, neither of which ships in the build.
