"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n/context";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
  isSubmitting?: boolean;
}

const SIZES: Record<NonNullable<FormDialogProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function FormDialog({
  open, onOpenChange, title, description, icon: Icon, children,
  onSubmit, submitLabel, size = "md", isSubmitting,
}: FormDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SIZES[size], "p-0 gap-0 max-h-[90vh] overflow-hidden")}>
        <DialogHeader className="p-5 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            {Icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
            )}
            {title}
          </DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-5">
            {children}
          </div>
        </ScrollArea>

        {onSubmit && (
          <DialogFooter className="p-4 border-t bg-muted/30">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t("action.cancel")}
            </Button>
            <Button onClick={onSubmit} disabled={isSubmitting}>
              {isSubmitting ? t("misc.saving") : (submitLabel ?? t("action.save"))}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FormGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const cls = cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3";
  return <div className={cn("grid gap-4", cls)}>{children}</div>;
}
