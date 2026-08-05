"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-2 mb-2 border-b", className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-[18px] w-[18px]" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-foreground leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-[13px] text-muted-foreground leading-tight">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
