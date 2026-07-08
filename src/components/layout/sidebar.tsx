"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { getNavForRole, type NavItem } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, GraduationCap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings,
};

const GROUP_LABELS: Record<NavItem["group"], string> = {
  overview: "nav.group.overview",
  training: "nav.group.training",
  assessments: "nav.group.assessments",
  compliance: "nav.group.compliance",
  system: "nav.group.system",
};

const GROUP_ORDER: NavItem["group"][] = ["overview", "training", "assessments", "compliance", "system"];

export function Sidebar() {
  const { t } = useI18n();
  const { currentRoute, navigate, user } = useAppStore();

  if (!user) return null;
  const items = getNavForRole(user.role);

  // Group items
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(GROUP_LABELS[group] as never),
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight truncate">TrainFlow</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{t("app.tagline")}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto tf-scroll px-2 py-3">
        {grouped.map(({ group, label, items: groupItems }) => (
          <div key={group} className="mb-4">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <ul className="space-y-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = currentRoute === item.key;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => navigate(item.key)}
                      className={cn(
                        "relative flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "tf-nav-active"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t(item.labelKey as never)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 shrink-0">
        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-0.5">TrainFlow TMS</div>
          <div>v1.0.0 · Enterprise</div>
        </div>
      </div>
    </aside>
  );
}
