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

> [!IMPORTANT]
> `db:seed` refuses to run unless `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` are
> both set, and never prints the password. There is deliberately no default: the seed
> previously shipped a publicly-known admin account (`ChangeMeInProduction!2024`) to
> every deployment and echoed it into the build log.
>
> The committed `db/custom.db` is demo data. It is fine for local development, but
> provision a fresh database for anything reachable from a network.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Prisma connection string. SQLite for dev, PostgreSQL for production. |
| `JWT_SECRET` | yes | Session signing key, 32+ bytes. The app refuses to boot without it. |
| `SCHEDULER_SECRET` | yes | Bearer token guarding `POST /api/report-scheduler/tick`. |
| `SUPER_ADMIN_EMAIL` | seed only | Super-admin address created by `db:seed`. Required. |
| `SUPER_ADMIN_PASSWORD` | seed only | Super-admin password created by `db:seed`. Required, 12+ chars. |
| `APP_URL` | production | Absolute base URL used to build QR check-in and certificate verification links, where no request Origin is available. |
| `SETTINGS_SECRET_KEY` | if using email | Encrypts secret Setting values (the SMTP password) at rest. 32+ chars. |
| `SMTP_PASSWORD` | optional | Takes precedence over the stored SMTP password, so the secret never enters the database. |

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

## Testing

```bash
npm test         # unit suites (mocked Prisma) — fast, hermetic
npm run test:int # integration suites against a throwaway SQLite file
npm run test:cov # unit suites with coverage
```

Unit tests mock `@/lib/db`. The one exception is `nextRefNumber`, whose correctness
depends on how SQL treats NULL inside a unique index — a claim no mock can prove — so it
has an integration suite that provisions a real database in `.tmp/`.

## Notes

`next.config.ts` sets `typescript.ignoreBuildErrors: false`: a type error fails the
build. `npx tsc --noEmit` and `npx eslint .` are both clean across `src/` and `scripts/`.

Public, unauthenticated surfaces:

| Route | Purpose |
| --- | --- |
| `/check-in?token=…` | QR attendance. The token in the QR is the credential; the session's QR activity window and rate limiting are the controls. |
| `/verify/<token>` | Certificate verification. This is the URL printed and QR-encoded on every generated certificate. |
| `GET /api/certificates/verify?token=…` | The same verification as JSON, for integrations. |

Email delivery is only real once SMTP is configured in Settings. Until then report
executions are recorded with `emailStatus: "SIMULATED"` and an execution status of
`COMPLETED` — never `SENT`. Generated files are stored and downloadable either way.
