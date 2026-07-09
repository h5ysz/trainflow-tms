// GCCLAB TMS — RBAC permission matrix
// Modules + actions per role.
// SUPER_ADMIN: full access (everything)
// COORDINATOR: almost everything except system settings
// TRAINER: limited to delivery / assessment modules
// CONTRACTOR: limited to their own requests / certificates / notifications

export type UserRole = "SUPER_ADMIN" | "COORDINATOR" | "TRAINER" | "CONTRACTOR" | "VIEWER";

export type RouteKey =
  | "dashboard"
  | "companies"
  | "company-contacts"
  | "trainers"
  | "trainer-qualifications"
  | "trainees"
  | "courses"
  | "requests"
  | "sessions"
  | "session-detail"
  | "scheduling"
  | "attendance"
  | "qr-code"
  | "pre-test"
  | "final-test"
  | "evaluation"
  | "certificates"
  | "reports"
  | "report-schedules"
  | "notifications"
  | "audit-log"
  | "settings"
  | "user-approvals"
  | "user-management"
  | "roles";

export type Action = "view" | "create" | "edit" | "delete";

export const ACTIONS: Action[] = ["view", "create", "edit", "delete"];

/**
 * Every module, for building permission pickers. Role.permissions stores
 * "module.action" strings with wildcards — "*", "companies.*", "reports.view"
 * — matching the vocabulary seeded in scripts/seed.ts.
 *
 * Excludes "session-detail": it is a detail view reached from the sessions
 * list, not a module a role is granted separately.
 */
export const ALL_MODULES: RouteKey[] = [
  "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
  "trainees", "courses", "requests", "sessions", "scheduling", "attendance", "qr-code",
  "pre-test", "final-test", "evaluation", "certificates", "reports", "report-schedules",
  "notifications", "audit-log", "settings", "user-approvals", "user-management", "roles",
];

// Module visibility per role
// =====================================================================
// Coordinator and Trainer have EQUIVALENT operational permissions.
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
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
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
  ],
  // Coordinator and Trainer share the SAME operational modules
  COORDINATOR: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "evaluation",
    "certificates",
    "reports",
    // The report-schedules endpoints are requireRole("SUPER_ADMIN","COORDINATOR").
    "report-schedules",
    "notifications",
    "audit-log",
    "user-approvals",
  ],
  TRAINER: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "evaluation",
    "certificates",
    "reports",
    "notifications",
    "audit-log",
    "user-approvals",
  ],
  VIEWER: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
    "trainees",
    "courses",
    "requests",
    "sessions",
    "session-detail",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "evaluation",
    "certificates",
    "reports",
    "notifications",
    "audit-log",
  ],
  CONTRACTOR: [
    "dashboard",
    "trainees",
    "requests",
    "certificates",
    "notifications",
  ],
};

// Module-level action permissions per role
// =====================================================================
// Coordinator and Trainer have EQUIVALENT operational permissions.
// The ONLY difference: Super Admin exclusively controls Settings.
// =====================================================================

// Shared operational permissions — used by both COORDINATOR and TRAINER
const OPERATIONAL_PERMISSIONS: Partial<Record<RouteKey, Action[]>> = {
  companies: ["view", "create", "edit", "delete"],
  "company-contacts": ["view", "create", "edit", "delete"],
  trainers: ["view", "create", "edit", "delete"],
  "trainer-qualifications": ["view", "create", "edit", "delete"],
  trainees: ["view", "create", "edit", "delete"],
  courses: ["view", "create", "edit", "delete"],
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

export const actionPermissions: Record<UserRole, Partial<Record<RouteKey, Action[]>>> = {
  SUPER_ADMIN: {
    // Super admin can do everything — including Settings (exclusive)
  },
  COORDINATOR: {
    ...OPERATIONAL_PERMISSIONS,
    "user-approvals": ["view", "create", "edit"],
    "report-schedules": ["view", "create", "edit", "delete"],
  },
  TRAINER: {
    ...OPERATIONAL_PERMISSIONS,
    "user-approvals": ["view", "create", "edit"],
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
  CONTRACTOR: {
    trainees: ["view", "create", "edit"],
    requests: ["view", "create"],
    certificates: ["view"],
    notifications: ["view"],
  },
};

export function canAccessModule(role: UserRole, module: RouteKey): boolean {
  return moduleAccess[role].includes(module);
}

export function canPerformAction(
  role: UserRole,
  module: RouteKey,
  action: Action
): boolean {
  if (role === "SUPER_ADMIN") return true;
  const allowed = actionPermissions[role][module];
  if (!allowed) return false;
  return allowed.includes(action);
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

  // Training Operations
  { key: "companies", labelKey: "nav.companies", icon: "Building2", group: "training" },
  { key: "company-contacts", labelKey: "nav.companyContacts", icon: "Contact", group: "training" },
  { key: "trainees", labelKey: "nav.trainees", icon: "UserSquare", group: "training" },
  { key: "trainers", labelKey: "nav.trainers", icon: "Users", group: "training" },
  { key: "trainer-qualifications", labelKey: "nav.trainerQualifications", icon: "Award", group: "training" },
  { key: "courses", labelKey: "nav.courses", icon: "BookOpen", group: "training" },
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
  { key: "settings", labelKey: "nav.settings", icon: "Settings", group: "system" },
];

export function getNavForRole(role: UserRole): NavItem[] {
  return navItems.filter((item) => canAccessModule(role, item.key));
}
