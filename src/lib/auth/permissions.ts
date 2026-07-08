// TrainFlow TMS — RBAC permission matrix
// Modules + actions per role.
// SUPER_ADMIN: full access (everything)
// COORDINATOR: almost everything except system settings
// TRAINER: limited to delivery / assessment modules
// CONTRACTOR: limited to their own requests / certificates / notifications

export type UserRole = "SUPER_ADMIN" | "COORDINATOR" | "TRAINER" | "CONTRACTOR";

export type RouteKey =
  | "dashboard"
  | "companies"
  | "company-contacts"
  | "trainers"
  | "trainer-qualifications"
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
  | "settings";

export type Action = "view" | "create" | "edit" | "delete";

// Module visibility per role
export const moduleAccess: Record<UserRole, RouteKey[]> = {
  SUPER_ADMIN: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
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
  ],
  COORDINATOR: [
    "dashboard",
    "companies",
    "company-contacts",
    "trainers",
    "trainer-qualifications",
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
  TRAINER: [
    "dashboard",
    "courses",
    "sessions",
    "scheduling",
    "attendance",
    "qr-code",
    "pre-test",
    "final-test",
    "evaluation",
    "certificates",
    "notifications",
  ],
  CONTRACTOR: [
    "dashboard",
    "requests",
    "certificates",
    "notifications",
  ],
};

// Module-level action permissions per role
export const actionPermissions: Record<UserRole, Partial<Record<RouteKey, Action[]>>> = {
  SUPER_ADMIN: {
    // Super admin can do everything
  },
  COORDINATOR: {
    companies: ["view", "create", "edit", "delete"],
    "company-contacts": ["view", "create", "edit", "delete"],
    trainers: ["view", "create", "edit", "delete"],
    "trainer-qualifications": ["view", "create", "edit", "delete"],
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
  },
  TRAINER: {
    courses: ["view"],
    sessions: ["view"],
    scheduling: ["view"],
    attendance: ["view", "create", "edit"],
    "qr-code": ["view", "create"],
    "pre-test": ["view", "create", "edit"],
    "final-test": ["view", "create", "edit"],
    evaluation: ["view"],
    certificates: ["view"],
    notifications: ["view"],
  },
  CONTRACTOR: {
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
  icon: string; // lucide icon name
  group: "overview" | "training" | "assessments" | "compliance" | "system";
}

export const navItems: NavItem[] = [
  // Overview
  { key: "dashboard", labelKey: "nav.dashboard", icon: "LayoutDashboard", group: "overview" },

  // Training Operations
  { key: "companies", labelKey: "nav.companies", icon: "Building2", group: "training" },
  { key: "company-contacts", labelKey: "nav.companyContacts", icon: "Contact", group: "training" },
  { key: "trainers", labelKey: "nav.trainers", icon: "Users", group: "training" },
  { key: "trainer-qualifications", labelKey: "nav.trainerQualifications", icon: "Award", group: "training" },
  { key: "courses", labelKey: "nav.courses", icon: "BookOpen", group: "training" },
  { key: "requests", labelKey: "nav.requests", icon: "ClipboardList", group: "training" },
  { key: "sessions", labelKey: "nav.sessions", icon: "CalendarDays", group: "training" },
  { key: "scheduling", labelKey: "nav.scheduling", icon: "CalendarRange", group: "training" },
  { key: "attendance", labelKey: "nav.attendance", icon: "UserCheck", group: "training" },
  { key: "qr-code", labelKey: "nav.qrCode", icon: "QrCode", group: "training" },

  // Assessments & Quality
  { key: "pre-test", labelKey: "nav.preTest", icon: "FilePen", group: "assessments" },
  { key: "final-test", labelKey: "nav.finalTest", icon: "FileCheck2", group: "assessments" },
  { key: "evaluation", labelKey: "nav.evaluation", icon: "Star", group: "assessments" },

  // Compliance & Records
  { key: "certificates", labelKey: "nav.certificates", icon: "BadgeCheck", group: "compliance" },
  { key: "reports", labelKey: "nav.reports", icon: "BarChart3", group: "compliance" },
  { key: "audit-log", labelKey: "nav.auditLog", icon: "ScrollText", group: "compliance" },

  // System
  { key: "notifications", labelKey: "nav.notifications", icon: "Bell", group: "system" },
  { key: "settings", labelKey: "nav.settings", icon: "Settings", group: "system" },
];

export function getNavForRole(role: UserRole): NavItem[] {
  return navItems.filter((item) => canAccessModule(role, item.key));
}
