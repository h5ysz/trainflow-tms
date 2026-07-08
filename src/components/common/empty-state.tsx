"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-4", className)}>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-4">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground max-w-md">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
