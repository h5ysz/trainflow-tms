// GCCLAB TMS — RBAC permission matrix
// Modules + actions per role.
// SUPER_ADMIN: full access (everything)
// COORDINATOR: almost everything except system settings
// TRAINER: limited to delivery / assessment modules
// CONTRACTOR: limited to their own requests / certificates / notifications

export type UserRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "COORDINATOR" | "TRAINER" | "AUDITOR" | "CONTRACTOR" | "VIEWER";

export type RouteKey =
  | "dashboard"
  | "companies"
  | "company-contacts"
  | "trainers"
  | "trainer-qualifications"
  | "trainees"
  | "courses"
  | "course-detail"
  | "course-materials"
  | "workshops"
  | "requests"
  | "sessions"
  | "session-detail"
  | "trainee-detail"
  | "scheduling"
  | "attendance"
  | "qr-code"
  | "pre-test"
  | "final-test"
  | "exam-attempts"
  | "exam-sets"
  | "evaluation"
  | "certificates"
  | "reports"
  | "report-schedules"
  | "notifications"
  | "audit-log"
  | "settings"
  | "user-approvals"
  | "user-management"
  | "roles"
  | "worker-passports"
  | "compliance-matrix"
  | "executive-dashboard"
  | "renewal-dashboard"
  | "ai-dashboard"
  // Floating AI Copilot (independent of ai-dashboard)
  | "copilot"
  // Financial module
  | "finance"
  | "invoices"
  | "quotations"
  | "payments"
  | "receipts"
  | "bank-accounts"
  | "financial-settings"
  | "financial-reports"
  // Trainer claims (overtime + business mission / daily allowance)
  | "claims"
  | "claim-detail";

export type Action = "view" | "create" | "edit" | "delete";

export const ACTIONS: Action[] = ["view", "create", "edit", "delete"];

/**
 * Every module, for building permission pickers. Role.permissions stores
 * "module.action" strings with wildcards — "*", "companies.*", "reports.view"
 * — matching the vocabulary seeded in scripts/seed.ts.
 *
 * "session-detail" / "trainee-detail" / "course-detail" are listed so the
 * registry tests can verify nav coverage, but they carry no direct grants.
 * "exam-attempts" IS directly grantable: `exam-attempts.view` gives a
 * results-only role (e.g. the coordinator) read access to attempt SCORES
 * without the questions or any ability to start/manage an exam.
 */
export const ALL_MODULES: RouteKey[] = [
  "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
  "trainees", "courses", "workshops", "requests", "sessions", "scheduling", "attendance", "qr-code",
  "pre-test", "final-test", "exam-attempts", "evaluation", "certificates", "reports", "report-schedules",
  "notifications", "audit-log", "settings", "user-approvals", "user-management", "roles",
  "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard",   "session-detail", "trainee-detail", "course-detail", "course-materials", "ai-dashboard", "copilot",
  "exam-sets",
  "claims", "claim-detail",
];

// Module visibility per role
// =====================================================================
// Coordinator: request review + scheduling + execution oversight.
// Trainer: delivery only — sessions, attendance, tests and evaluations for the
// sessions they are assigned to. Read-only visibility into the courses they run
// and the trainees enrolled in their own sessions (both scoped server-side).
// NO administrative modules (companies, trainers, requests, certificates,
// reports, audit log, approvals...).
// Super Admin's exclusive privileges are limited to:
//   - Settings (system configuration, branding, integrations)
//   - Users & Roles management
//   - Audit Log (administration)
// Contractor is scoped to their own company's data only.
// =====================================================================
export const moduleAccess: Record<UserRole, RouteKey[]> = {
  SUPER_ADMIN: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "course-detail",
    "workshops",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "exam-attempts",
    "evaluation",
    "certificates",
    "reports",
    "report-schedules",
    "notifications",
    "audit-log",
    "settings",
    "user-approvals",
    "user-management",
    "roles",
    "worker-passports",
    "compliance-matrix",
    "executive-dashboard",
    "renewal-dashboard",
    "ai-dashboard",
    "copilot",
    "claims",
    "claim-detail",
  ],
  COMPANY_ADMIN: [
    "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
    "trainees", "courses", "course-detail", "workshops", "requests", "sessions", "session-detail", "trainee-detail",
    "scheduling", "attendance", "certificates", "reports", "report-schedules",
    "notifications", "audit-log", "user-approvals", "user-management",
    "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard",
    "copilot",
  ],
  // Coordinator: request review + scheduling + execution oversight.
  // The session barcode (QR), Pre-Test, Final-Test, and Exam Questions are
  // hidden from the coordinator's navigation (they belong to the Trainer /
  // Training Admin) — the coordinator has NO relation to barcodes, questions,
  // test prep, or running tests. They keep only a results-only "Exam Results"
  // entry (module "exam-attempts", `exam-attempts.view`): a read-only list of
  // attempt scores, with question content stripped server-side.
  COORDINATOR: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "course-detail",
    "workshops",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    // Results-only (see the comment above the role map): scores without questions.
    "exam-attempts",
    "evaluation",
    "certificates",
    "reports",
    // The report-schedules endpoints are requireRole("SUPER_ADMIN","COORDINATOR").
    "report-schedules",
    "notifications",
    "audit-log",
    "user-approvals",
    "worker-passports",
    "compliance-matrix",
    "executive-dashboard",
    "renewal-dashboard",
  // AI dashboard (added to the COORDINATOR role's DB permissions via
  // scripts/migrate-ai-dashboard-permissions.ts / seed-test-users.ts).
  "ai-dashboard",
  // Floating AI Copilot (independent of ai-dashboard)
  "copilot",
  // Financial module
  "finance", "invoices", "quotations", "payments", "receipts", "bank-accounts",
  "financial-settings", "financial-reports",
  // Trainer claims (generate, review, approve, export)
  "claims",
  "claim-detail",
  ],
  // Trainer: strictly delivery-scoped. Only the modules a trainer needs to run
  // the sessions they are assigned to. `workshops` stays granted so an
  // authorized trainer can open it, but the nav item and direct URL are gated on
  // the data-driven `trainerNav.workshops` flag (see /api/auth/me), and the API
  // only ever returns that trainer's own workshops.
  TRAINER: [
    "dashboard",
    "courses",
    "trainees",
    "trainee-detail",
    "sessions",
    "session-detail",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "exam-attempts",
    "evaluation",
    "workshops",
    "notifications",
    // Trainer claims: view + adjust/submit their OWN claims only (server-scoped).
    "claims",
    "claim-detail",
    "copilot",
  ],
  VIEWER: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "course-detail",
    "workshops",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "exam-attempts",
    "evaluation",
    "certificates",
    "reports",
    "notifications",
    "audit-log",
    "copilot",
  ],
  AUDITOR: [
    "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
    "trainees", "courses", "course-detail", "workshops", "requests", "sessions", "session-detail", "trainee-detail",
    "scheduling", "attendance", "qr-code", "pre-test", "final-test", "exam-attempts",
    "evaluation", "certificates", "reports", "notifications", "audit-log",
    "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard", "session-detail", "trainee-detail",
    // Financial module (read-only)
    "finance", "invoices", "quotations", "payments", "receipts", "bank-accounts",
    "financial-settings", "financial-reports",
    // Trainer claims (read-only)
    "claims",
    "claim-detail",
    "copilot",
  ],
  CONTRACTOR: [
    "dashboard",
    "trainees",
    "requests",
    "certificates",
    "notifications",
    "worker-passports",
    "renewal-dashboard",
    "copilot",
  ],
};

// Module-level action permissions per role
// =====================================================================
// Coordinator holds the shared OPERATIONAL_PERMISSIONS (full CRUD on the
// operational modules). Trainer does NOT: it has its own TRAINER_PERMISSIONS
// limited to read + the delivery actions on attendance. Super Admin exclusively
// controls Settings, users and roles.
// =====================================================================

// Shared operational permissions — used by both COORDINATOR and TRAINER
const OPERATIONAL_PERMISSIONS: Partial<Record<RouteKey, Action[]>> = {
  companies: ["view", "create", "edit", "delete"],
  "company-contacts": ["view", "create", "edit", "delete"],
  trainers: ["view", "create", "edit", "delete"],
  "trainer-qualifications": ["view", "create", "edit", "delete"],
  trainees: ["view", "create", "edit", "delete"],
  courses: ["view", "create", "edit", "delete"],
  workshops: ["view", "create", "edit", "delete"],
  requests: ["view", "create", "edit", "delete"],
  sessions: ["view", "create", "edit", "delete"],
  scheduling: ["view", "create", "edit", "delete"],
  attendance: ["view", "create", "edit", "delete"],
  // NOTE: qr-code, pre-test, and final-test are deliberately NOT here. The
  // session barcode (QR) and the tests are trainer delivery tools (see
  // TRAINER_PERMISSIONS below) — a coordinator manages the session lifecycle,
  // not the barcode or the tests. They keep a read-only view of attempt scores
  // via the dedicated `exam-attempts` grant (see COORDINATOR below).
  evaluation: ["view", "create", "edit", "delete"],
  certificates: ["view", "create", "edit", "delete"],
  // Trainer claims: full operational control for the coordinator (generate,
  // review, approve/return, finalize, export, configure claim settings).
  claims: ["view", "create", "edit", "delete"],
  reports: ["view"],
  notifications: ["view"],
  "audit-log": ["view"],
};

// Trainer's own, delivery-scoped permission set. Intentionally NOT derived from
// OPERATIONAL_PERMISSIONS (which belongs to the coordinator): a trainer gets no
// create/delete on sessions/courses/trainees/requests/companies, no access to
// certificates/reports/audit at all, and no administrative modules. `courses.view`
// and `trainees.view` are scoped server-side to the trainer's OWN sessions
// (src/lib/api/trainer-scope.ts). `sessions.edit`, the `qr-code.create`, and the
// exam `create`/`edit`s are the delivery actions (start/complete a session,
// activate its QR window, run + manage pre/final tests) — every one of them is
// additionally restricted server-side to the trainer's OWN sessions, so a
// direct-URL request for another trainer's record returns 403.
const TRAINER_PERMISSIONS: Partial<Record<RouteKey, Action[]>> = {
  dashboard: ["view"],
  courses: ["view"],
  "course-materials": ["view", "create", "edit", "delete"],
  trainees: ["view"],
  sessions: ["view", "edit"],
  attendance: ["view", "create", "edit"],
  "qr-code": ["view", "create"],
  "pre-test": ["view", "create", "edit"],
  "final-test": ["view", "create", "edit"],
  evaluation: ["view"],
  workshops: ["view"],
  notifications: ["view"],
  claims: ["view", "create", "edit"],
};

export const actionPermissions: Record<UserRole, Partial<Record<RouteKey, Action[]>>> = {
  SUPER_ADMIN: {
    // Super admin can do everything — including Settings (exclusive)
    copilot: ["view"],
  },
  COMPANY_ADMIN: {
    companies: ["view", "edit"], "company-contacts": ["view", "create", "edit", "delete"],
    trainers: ["view"], "trainer-qualifications": ["view"], trainees: ["view", "create", "edit"],
    courses: ["view"], requests: ["view", "create", "edit"], sessions: ["view"],
    scheduling: ["view"], attendance: ["view"], certificates: ["view"],
    reports: ["view"], "report-schedules": ["view", "create", "edit", "delete"],
    notifications: ["view"], "audit-log": ["view"], "user-approvals": ["view", "create", "edit"],
    "user-management": ["view"], "worker-passports": ["view"], "compliance-matrix": ["view"],
    "executive-dashboard": ["view"], "renewal-dashboard": ["view"],
    copilot: ["view"],
  },
  COORDINATOR: {
    ...OPERATIONAL_PERMISSIONS,
    // Results only: the coordinator reads attempt SCORES (list + detail), with
    // question content stripped server-side. `view` alone — no create/edit — so
    // start/submit/reopen/edit-result all stay 403 for them.
    "exam-attempts": ["view"],
    "user-approvals": ["view", "create", "edit"],
    "report-schedules": ["view", "create", "edit", "delete"],
    "ai-dashboard": ["view"],
    copilot: ["view"],
  },
  TRAINER: {
    ...TRAINER_PERMISSIONS,
    copilot: ["view"],
  },
  VIEWER: {
    companies: ["view"],
    "company-contacts": ["view"],
    trainers: ["view"],
    "trainer-qualifications": ["view"],
    trainees: ["view"],
    courses: ["view"],
    requests: ["view"],
    sessions: ["view"],
    scheduling: ["view"],
    attendance: ["view"],
    "qr-code": ["view"],
    "pre-test": ["view"],
    "final-test": ["view"],
    evaluation: ["view"],
    certificates: ["view"],
    reports: ["view"],
    notifications: ["view"],
    "audit-log": ["view"],
    copilot: ["view"],
  },
  AUDITOR: {
    companies: ["view"], "company-contacts": ["view"], trainers: ["view"],
    "trainer-qualifications": ["view"], trainees: ["view"], courses: ["view"],
    requests: ["view"], sessions: ["view"], scheduling: ["view"], attendance: ["view"],
    "qr-code": ["view"], "pre-test": ["view"], "final-test": ["view"], evaluation: ["view"],
    certificates: ["view"], reports: ["view"], notifications: ["view"], "audit-log": ["view"],
    "worker-passports": ["view"], "compliance-matrix": ["view"],
    "executive-dashboard": ["view"], "renewal-dashboard": ["view"],
    // Financial module (read-only)
    invoices: ["view"], quotations: ["view"], payments: ["view"], receipts: ["view"],
    "bank-accounts": ["view"], "financial-reports": ["view"], "financial-settings": ["view"],
    // Trainer claims (read-only)
    claims: ["view"],
    copilot: ["view"],
  },
  CONTRACTOR: {
    trainees: ["view", "create", "edit", "delete"],
    requests: ["view", "create"],
    certificates: ["view"],
    notifications: ["view"],
    copilot: ["view"],
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Live RBAC — resolves against a user's assigned Role.permissions (DB-driven)
// instead of the hardcoded tables above. `moduleAccess`/`actionPermissions`
// remain as the canonical description of each system role's grants: they
// seed `Role.permissions` (scripts/seed.ts) and back the fallback path in
// resolveEffectivePermissions() (src/lib/auth/api.ts) when a user has no
// resolvable Role row.
//
// Permission strings: "*" (everything), "module.*" (every action on a
// module), or "module.action". session-detail / exam-attempts are views
// reached from another page, not modules with their own grants — they
// resolve against the module(s) that actually gate them.
// ─────────────────────────────────────────────────────────────────────────

const MODULE_ALIASES: Partial<Record<RouteKey, RouteKey[]>> = {
  "session-detail": ["sessions"],
  "trainee-detail": ["trainees"],
  "course-detail": ["courses"],
  "claim-detail": ["claims"],
  // The "Exam Results" page lists/opens pre-test + final-test attempts. Trainers
  // and auditors reach it through the pre-test/final-test modules; a results-only
  // role (e.g. coordinator) holds a direct `exam-attempts.view` grant instead.
  "exam-attempts": ["exam-attempts", "pre-test", "final-test"],
  // The standalone "Exam Questions" manager is a view over the Question Bank /
  // session exam sets — it authorizes against the modules that actually gate
  // them, so no separate DB grant is required.
  "exam-sets": ["pre-test", "final-test"],
};

function hasPermission(permissions: string[], module: RouteKey, action: Action): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes(`${module}.*`)) return true;
  return permissions.includes(`${module}.${action}`);
}

export function canAccessModule(permissions: string[], module: RouteKey): boolean {
  const targets = MODULE_ALIASES[module] ?? [module];
  return targets.some((m) => hasPermission(permissions, m, "view"));
}

export function canPerformAction(
  permissions: string[],
  module: RouteKey,
  action: Action
): boolean {
  const targets = MODULE_ALIASES[module] ?? [module];
  return targets.some((m) => hasPermission(permissions, m, action));
}

// Module grouping for navigation
export interface NavItem {
  key: RouteKey;
  labelKey: string;
  icon: string;
  group: "dashboard" | "training" | "assessment" | "reports" | "system";
}

export const navItems: NavItem[] = [
  // Dashboard (standalone)
  { key: "dashboard", labelKey: "nav.dashboard", icon: "LayoutDashboard", group: "dashboard" },
  { key: "ai-dashboard", labelKey: "nav.aiDashboard", icon: "Sparkles", group: "dashboard" },

  // Training Operations
  { key: "companies", labelKey: "nav.companies", icon: "Building2", group: "training" },
  { key: "company-contacts", labelKey: "nav.companyContacts", icon: "Contact", group: "training" },
  { key: "trainees", labelKey: "nav.trainees", icon: "UserSquare", group: "training" },
  { key: "trainers", labelKey: "nav.trainers", icon: "Users", group: "training" },
  { key: "trainer-qualifications", labelKey: "nav.trainerQualifications", icon: "Award", group: "training" },
  { key: "courses", labelKey: "nav.courses", icon: "BookOpen", group: "training" },
  { key: "workshops", labelKey: "nav.workshops", icon: "Wrench", group: "training" },
  { key: "requests", labelKey: "nav.requests", icon: "ClipboardList", group: "training" },
  { key: "sessions", labelKey: "nav.sessions", icon: "CalendarDays", group: "training" },
  { key: "scheduling", labelKey: "nav.scheduling", icon: "CalendarRange", group: "training" },
  { key: "attendance", labelKey: "nav.attendance", icon: "UserCheck", group: "training" },
  { key: "qr-code", labelKey: "nav.qrCode", icon: "QrCode", group: "training" },
  { key: "claims", labelKey: "nav.claims", icon: "FileText", group: "training" },

  // Assessment
  { key: "pre-test", labelKey: "nav.preTest", icon: "FilePen", group: "assessment" },
  { key: "final-test", labelKey: "nav.finalTest", icon: "FileCheck2", group: "assessment" },
  { key: "exam-sets", labelKey: "nav.examSets", icon: "ListChecks", group: "assessment" },
  // Results-only entry: shown only to roles without a dedicated pre-test/final-test
  // module (see getNavForRole), so the coordinator can read attempt scores.
  { key: "exam-attempts", labelKey: "nav.examAttempts", icon: "ClipboardList", group: "assessment" },
  { key: "evaluation", labelKey: "nav.evaluation", icon: "Star", group: "assessment" },
  { key: "certificates", labelKey: "nav.certificates", icon: "BadgeCheck", group: "assessment" },

  // Reports
  { key: "reports", labelKey: "nav.reports", icon: "BarChart3", group: "reports" },
  { key: "report-schedules", labelKey: "nav.reportSchedules", icon: "CalendarClock", group: "reports" },

  // System
  { key: "audit-log", labelKey: "nav.auditLog", icon: "ScrollText", group: "system" },
  { key: "notifications", labelKey: "nav.notifications", icon: "Bell", group: "system" },
  { key: "user-approvals", labelKey: "nav.userApprovals", icon: "UserPlus", group: "system" },
  { key: "user-management", labelKey: "nav.userManagement", icon: "ShieldCheck", group: "system" },
  { key: "roles", labelKey: "nav.roles", icon: "ShieldCheck", group: "system" },
  { key: "worker-passports", labelKey: "nav.workerPassports", icon: "BookUser", group: "system" },
  { key: "compliance-matrix", labelKey: "nav.complianceMatrix", icon: "ClipboardCheck", group: "system" },
  { key: "executive-dashboard", labelKey: "nav.executiveDashboard", icon: "TrendingUp", group: "system" },
  { key: "renewal-dashboard", labelKey: "nav.renewalDashboard", icon: "RefreshCw", group: "system" },
  { key: "settings", labelKey: "nav.settings", icon: "Settings", group: "system" },
];

// Trainer-delivery modules that must NEVER appear in the coordinator's menu,
// even if a stale Role row re-grants them (the session barcode and test prep
// belong to the Trainer / Training Admin). Permission-based filtering would
// otherwise re-add the entry the moment such a grant exists.
const COORDINATOR_HIDDEN_NAV = new Set<RouteKey>(["qr-code", "pre-test", "final-test", "exam-sets"]);

export function getNavForRole(permissions: string[], role?: UserRole): NavItem[] {
  return navItems.filter((item) => {
    if (role === "COORDINATOR" && COORDINATOR_HIDDEN_NAV.has(item.key)) return false;
    // The standalone "Exam Results" entry is only for roles that hold exam access
    // WITHOUT a dedicated pre-test/final-test module (e.g. the coordinator). Anyone
    // with pre-test/final-test reach attempts from those pages, so a duplicate
    // entry is suppressed.
    if (item.key === "exam-attempts") {
      const hasExamModule =
        canAccessModule(permissions, "pre-test") || canAccessModule(permissions, "final-test");
      return canAccessModule(permissions, "exam-attempts") && !hasExamModule;
    }
    return canAccessModule(permissions, item.key);
  });
}
