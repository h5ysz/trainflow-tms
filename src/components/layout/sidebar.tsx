"use client";

import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { getNavForRole, type NavItem } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Building2, Contact, Users, Award, UserSquare, BookOpen,
  ClipboardList, CalendarDays, CalendarRange, CalendarClock, UserCheck, QrCode,
  FilePen, FileCheck2, Star, BadgeCheck, BarChart3, ScrollText,
  Bell, Settings, UserPlus, ShieldCheck,
};

const GROUP_ORDER: NavItem["group"][] = ["dashboard", "training", "assessment", "reports", "system"];

const GROUP_LABELS: Record<NavItem["group"], string> = {
  dashboard: "nav.group.dashboard",
  training: "nav.group.training",
  assessment: "nav.group.assessment",
  reports: "nav.group.reports",
  system: "nav.group.system",
};

export function Sidebar() {
  const { t, locale } = useI18n();
  const { currentRoute, navigate, user } = useAppStore();

  if (!user) return null;
  const items = getNavForRole(user.permissions);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: t(GROUP_LABELS[group] as never),
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Brand — Official GCC Lab Logo */}
      <div className="flex h-16 items-center gap-3 px-5 border-b border-sidebar-border shrink-0">
        <Image
          src="/gcclab-icon.png"
          alt="GCC Lab"
          width={36}
          height={36}
          className="shrink-0 object-contain rounded-md"
        />
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight tracking-tight">
            {locale === "en" ? "GCC Lab" : "المختبر الخليجي"}
          </div>
          <div className="text-[10px] text-muted-foreground leading-tight font-medium">
            {locale === "en" ? "Training Management" : "إدارة التدريب"}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto tf-scroll px-3 py-4">
        {grouped.map(({ group, label, items: groupItems }) => (
          <div key={group} className="mb-5">
            {label && (
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {label}
              </div>
            )}
            <ul className="space-y-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = currentRoute === item.key;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => navigate(item.key)}
                      className={cn(
                        "relative flex items-center gap-3 w-full rounded-lg px-3 py-2 text-[13px] transition-all",
                        active
                          ? "tf-nav-active"
                          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
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
      <div className="border-t border-sidebar-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          <span className="font-medium">GCC Lab v1.0 RC1</span>
        </div>
      </div>
    </aside>
  );
}
