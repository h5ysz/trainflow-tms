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
  // Financial module
  | "finance"
  | "invoices"
  | "quotations"
  | "payments"
  | "receipts"
  | "bank-accounts"
  | "financial-settings"
  | "financial-reports";

export type Action = "view" | "create" | "edit" | "delete";

export const ACTIONS: Action[] = ["view", "create", "edit", "delete"];

/**
 * Every module, for building permission pickers. Role.permissions stores
 * "module.action" strings with wildcards — "*", "companies.*", "reports.view"
 * — matching the vocabulary seeded in scripts/seed.ts.
 *
 * Excludes "session-detail" and "exam-attempts": those are views reached from
 * another page, not modules a role is granted separately. Exam start/submit
 * authorise against pre-test / final-test.
 */
export const ALL_MODULES: RouteKey[] = [
  "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
  "trainees", "courses", "workshops", "requests", "sessions", "scheduling", "attendance", "qr-code",
  "pre-test", "final-test", "evaluation", "certificates", "reports", "report-schedules",
  "notifications", "audit-log", "settings", "user-approvals", "user-management", "roles",
  "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard", "session-detail", "trainee-detail", "ai-dashboard",
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
  ],
  COMPANY_ADMIN: [
    "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
    "trainees", "courses", "workshops", "requests", "sessions", "session-detail", "trainee-detail",
    "scheduling", "attendance", "certificates", "reports", "report-schedules",
    "notifications", "audit-log", "user-approvals", "user-management",
    "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard",
  ],
  // Coordinator: request review + scheduling + execution oversight.
  // Only QR Code, Pre-Test, and Final-Test are hidden from the coordinator's
  // navigation (they belong to the Trainer / Training Admin). All other
  // modules remain visible.
  COORDINATOR: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "workshops",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
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
  // Financial module
  "finance", "invoices", "quotations", "payments", "receipts", "bank-accounts",
  "financial-settings", "financial-reports",
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
  ],
  VIEWER: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
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
  ],
  AUDITOR: [
    "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
    "trainees", "courses", "workshops", "requests", "sessions", "session-detail", "trainee-detail",
    "scheduling", "attendance", "qr-code", "pre-test", "final-test", "exam-attempts",
    "evaluation", "certificates", "reports", "notifications", "audit-log",
    "worker-passports", "compliance-matrix", "executive-dashboard", "renewal-dashboard", "session-detail", "trainee-detail",
    // Financial module (read-only)
    "finance", "invoices", "quotations", "payments", "receipts", "bank-accounts",
    "financial-settings", "financial-reports",
  ],
  CONTRACTOR: [
    "dashboard",
    "trainees",
    "requests",
    "certificates",
    "notifications",
    "worker-passports",
    "renewal-dashboard",
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
  "qr-code": ["view", "create", "edit", "delete"],
  "pre-test": ["view", "create", "edit", "delete"],
  "final-test": ["view", "create", "edit", "delete"],
  evaluation: ["view", "create", "edit", "delete"],
  certificates: ["view", "create", "edit", "delete"],
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
  trainees: ["view"],
  sessions: ["view", "edit"],
  attendance: ["view", "create", "edit"],
  "qr-code": ["view", "create"],
  "pre-test": ["view", "create", "edit"],
  "final-test": ["view", "create", "edit"],
  evaluation: ["view"],
  workshops: ["view"],
  notifications: ["view"],
};

export const actionPermissions: Record<UserRole, Partial<Record<RouteKey, Action[]>>> = {
  SUPER_ADMIN: {
    // Super admin can do everything — including Settings (exclusive)
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
  },
  COORDINATOR: {
    ...OPERATIONAL_PERMISSIONS,
    "user-approvals": ["view", "create", "edit"],
    "report-schedules": ["view", "create", "edit", "delete"],
    "ai-dashboard": ["view"],
  },
  TRAINER: {
    ...TRAINER_PERMISSIONS,
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
  },
  CONTRACTOR: {
    trainees: ["view", "create", "edit"],
    requests: ["view", "create"],
    certificates: ["view"],
    notifications: ["view"],
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
  "exam-attempts": ["pre-test", "final-test"],
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

  // Assessment
  { key: "pre-test", labelKey: "nav.preTest", icon: "FilePen", group: "assessment" },
  { key: "final-test", labelKey: "nav.finalTest", icon: "FileCheck2", group: "assessment" },
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

export function getNavForRole(permissions: string[]): NavItem[] {
  return navItems.filter((item) => canAccessModule(permissions, item.key));
}
