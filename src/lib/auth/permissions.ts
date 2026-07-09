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
  | "scheduling"
  | "attendance"
  | "qr-code"
  | "pre-test"
  | "final-test"
  | "evaluation"
  | "certificates"
  | "reports"
  | "notifications"
  | "audit-log"
  | "settings"
  | "user-approvals"
  | "user-management"
  | "roles";

// Sprint 6 — extended action set for the full permission matrix.
// Each module can grant: view, create, edit, delete, approve, export, print,
// manage_users, manage_settings.
export type Action =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "print"
  | "manage_users"
  | "manage_settings";

// All actions available in the matrix (used by Role editor UI)
export const ALL_ACTIONS: Action[] = [
  "view", "create", "edit", "delete", "approve", "export", "print", "manage_users", "manage_settings",
];

// Human-readable labels (EN + AR) for each action — used by the matrix editor
export const ACTION_LABELS: Record<Action, { en: string; ar: string }> = {
  view: { en: "View", ar: "عرض" },
  create: { en: "Create", ar: "إنشاء" },
  edit: { en: "Edit", ar: "تعديل" },
  delete: { en: "Delete", ar: "حذف" },
  approve: { en: "Approve", ar: "اعتماد" },
  export: { en: "Export", ar: "تصدير" },
  print: { en: "Print", ar: "طباعة" },
  manage_users: { en: "Manage Users", ar: "إدارة المستخدمين" },
  manage_settings: { en: "Manage Settings", ar: "إدارة الإعدادات" },
};

// Per-module list of which actions are *applicable* (e.g. dashboard has no "delete")
export const MODULE_APPLICABLE_ACTIONS: Partial<Record<RouteKey, Action[]>> = {
  dashboard: ["view", "export"],
  companies: ["view", "create", "edit", "delete", "export", "print"],
  "company-contacts": ["view", "create", "edit", "delete", "export"],
  trainers: ["view", "create", "edit", "delete", "export"],
  "trainer-qualifications": ["view", "create", "edit", "delete", "export"],
  trainees: ["view", "create", "edit", "delete", "export", "print"],
  courses: ["view", "create", "edit", "delete", "export"],
  requests: ["view", "create", "edit", "delete", "approve", "export", "print"],
  sessions: ["view", "create", "edit", "delete", "approve", "export", "print"],
  scheduling: ["view", "create", "edit", "delete", "export"],
  attendance: ["view", "create", "edit", "export", "print"],
  "qr-code": ["view", "create"],
  "pre-test": ["view", "create", "edit", "export"],
  "final-test": ["view", "create", "edit", "export"],
  evaluation: ["view", "export"],
  certificates: ["view", "create", "edit", "delete", "export", "print"],
  reports: ["view", "export", "print"],
  notifications: ["view"],
  "audit-log": ["view", "export"],
  "user-approvals": ["view", "approve"],
  "user-management": ["view", "create", "edit", "delete", "manage_users", "export"],
  roles: ["view", "create", "edit", "delete", "manage_users"],
  settings: ["view", "manage_settings"],
};

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
  evaluation: ["view"],
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
  // SUPER_ADMIN can always see everything
  if (role === "SUPER_ADMIN") return true;
  // Dynamic override: if a runtime override map has been loaded (from DB Role.permissions),
  // check it first.
  if (dynamicModuleAccess[role]) {
    return dynamicModuleAccess[role]!.includes(module);
  }
  return moduleAccess[role].includes(module);
}

export function canPerformAction(
  role: UserRole,
  module: RouteKey,
  action: Action
): boolean {
  if (role === "SUPER_ADMIN") return true;
  // Dynamic override: if a runtime override map has been loaded (from DB Role.permissions),
  // check it first.
  if (dynamicActionPermissions[role]) {
    const allowed = dynamicActionPermissions[role]![module];
    if (!allowed) return false;
    return allowed.includes(action);
  }
  const allowed = actionPermissions[role][module];
  if (!allowed) return false;
  return allowed.includes(action);
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint 6 — Dynamic RBAC override mechanism
// ─────────────────────────────────────────────────────────────────────────
// Custom roles created in the DB store their permission matrix as an array of
// strings like ["companies.view", "companies.create", "sessions.*"] in
// Role.permissions. When a user logs in with a custom roleId, the API layer
// (requireRole / getCurrentUser) loads that array into the user's session and
// the frontend / API can call `loadRolePermissions(role, permissions)` to
// override the hardcoded map for that role.
//
// Format supported:
//   "*"                              → all actions on all modules (super-admin-equivalent)
//   "companies.view"                 → single module + action
//   "companies.*"                    → all applicable actions for that module
//   "companies"                      → view-only on that module (shorthand)
//
// On the SERVER side, this is loaded once per request from the User's Role.
// On the CLIENT side, it's loaded once after login from /api/auth/me.
// ─────────────────────────────────────────────────────────────────────────

const dynamicModuleAccess: Partial<Record<string, RouteKey[]>> = {};
const dynamicActionPermissions: Partial<Record<string, Partial<Record<RouteKey, Action[]>>>> = {};

export function clearRoleOverride(role: string) {
  delete dynamicModuleAccess[role];
  delete dynamicActionPermissions[role];
}

export function loadRolePermissions(role: string, permissions: string[] | null | undefined) {
  if (!permissions || permissions.length === 0) {
    clearRoleOverride(role);
    return;
  }

  // Super-admin wildcard
  if (permissions.includes("*")) {
    // Don't override SUPER_ADMIN's hardcoded behavior; just bail out.
    return;
  }

  const moduleSet = new Set<RouteKey>();
  const actionMap: Partial<Record<RouteKey, Action[]>> = {};

  for (const entry of permissions) {
    const [mod, act] = entry.split(".");
    if (!mod) continue;
    // Validate module name against known RouteKeys
    const knownModules: RouteKey[] = [
      "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
      "trainees", "courses", "requests", "sessions", "scheduling", "attendance", "qr-code",
      "pre-test", "final-test", "evaluation", "certificates", "reports", "notifications",
      "audit-log", "settings", "user-approvals", "user-management", "roles",
    ];
    if (!knownModules.includes(mod as RouteKey)) continue;
    const rMod = mod as RouteKey;

    moduleSet.add(rMod);

    if (!act || act === "*") {
      // Grant all applicable actions for this module
      const applicable = MODULE_APPLICABLE_ACTIONS[rMod] ?? ["view"];
      actionMap[rMod] = [...applicable];
    } else if (ALL_ACTIONS.includes(act as Action)) {
      // Single action
      if (!actionMap[rMod]) actionMap[rMod] = [];
      if (!actionMap[rMod]!.includes(act as Action)) {
        actionMap[rMod]!.push(act as Action);
      }
    }
  }

  dynamicModuleAccess[role] = Array.from(moduleSet);
  dynamicActionPermissions[role] = actionMap;
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
  { key: "attendance", labelKey: "nav.attendance", icon: "UserCheck", group: "training" },
  { key: "qr-code", labelKey: "nav.qrCode", icon: "QrCode", group: "training" },

  // Assessment
  { key: "pre-test", labelKey: "nav.preTest", icon: "FilePen", group: "assessment" },
  { key: "final-test", labelKey: "nav.finalTest", icon: "FileCheck2", group: "assessment" },
  { key: "evaluation", labelKey: "nav.evaluation", icon: "Star", group: "assessment" },
  { key: "certificates", labelKey: "nav.certificates", icon: "BadgeCheck", group: "assessment" },

  // Reports
  { key: "reports", labelKey: "nav.reports", icon: "BarChart3", group: "reports" },

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
