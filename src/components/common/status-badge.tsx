"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { LucideIcon } from "lucide-react";

// Maps status codes to colors and labels
const STATUS_STYLES: Record<string, string> = {
  // generic
  ACTIVE: "bg-success/10 text-success border-success/20",
  INACTIVE: "bg-muted text-muted-foreground border-border",
  SUSPENDED: "bg-warning/10 text-warning border-warning/20",
  DRAFT: "bg-muted text-muted-foreground border-border",

  // training request workflow
  PENDING: "bg-warning/10 text-warning border-warning/20",
  SUBMITTED: "bg-info/10 text-info border-info/20",
  UNDER_REVIEW: "bg-info/10 text-info border-info/20",
  APPROVED: "bg-success/10 text-success border-success/20",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/20",
  SCHEDULED: "bg-info/10 text-info border-info/20",
  IN_PROGRESS: "bg-info/10 text-info border-info/20",
  COMPLETED: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-destructive/10 text-destructive border-destructive/20",
  NO_SHOW: "bg-destructive/10 text-destructive border-destructive/20",

  // validity
  VALID: "bg-success/10 text-success border-success/20",
  EXPIRED: "bg-destructive/10 text-destructive border-destructive/20",
  EXPIRING_SOON: "bg-warning/10 text-warning border-warning/20",
  REVOKED: "bg-destructive/10 text-destructive border-destructive/20",

  // attendance
  PRESENT: "bg-success/10 text-success border-success/20",
  ABSENT: "bg-destructive/10 text-destructive border-destructive/20",
  LATE: "bg-warning/10 text-warning border-warning/20",
  EXCUSED: "bg-muted text-muted-foreground border-border",
  REGISTERED: "bg-info/10 text-info border-info/20",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { t } = useI18n();
  const style = STATUS_STYLES[status] ?? STATUS_STYLES["INACTIVE"];
  // Try translation; fall back to a prettified version of the status string
  const key = `status.${status}` as never;
  const translated = t(key);
  const label = translated === key ? status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : translated;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        style,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: string;
  className?: string;
}) {
  const { t } = useI18n();
  const styles: Record<string, string> = {
    LOW: "bg-muted text-muted-foreground border-border",
    NORMAL: "bg-info/10 text-info border-info/20",
    HIGH: "bg-warning/10 text-warning border-warning/20",
    URGENT: "bg-destructive/10 text-destructive border-destructive/20",
  };
  const label = (t as (key: string) => string)(`priority.${priority}`) ?? priority;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[priority] ?? styles.NORMAL,
        className
      )}
    >
      {label}
    </span>
  );
}

export function RoleBadge({
  role,
  className,
  icon: Icon,
}: {
  role: string;
  className?: string;
  icon?: LucideIcon;
}) {
  const { t } = useI18n();
  const styles: Record<string, string> = {
    SUPER_ADMIN: "bg-primary/10 text-primary border-primary/20",
    COORDINATOR: "bg-info/10 text-info border-info/20",
    TRAINER: "bg-warning/10 text-warning border-warning/20",
    CONTRACTOR: "bg-success/10 text-success border-success/20",
    VIEWER: "bg-muted text-muted-foreground border-border",
  };
  const label = (t as (key: string) => string)(`role.${role}`) ?? role;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        styles[role] ?? styles.VIEWER,
        className
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}
