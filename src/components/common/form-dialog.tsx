"use client";

import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { type LucideIcon, Maximize2, Minimize2 } from "lucide-react";
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
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
  isSubmitting?: boolean;
  /** When true, shows a maximize/restore button in the header. */
  allowMaximize?: boolean;
}

const SIZES: Record<NonNullable<FormDialogProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  "2xl": "max-w-5xl",
  "3xl": "max-w-6xl",
  full: "max-w-[90vw] w-[90vw]",
};

export function FormDialog({
  open, onOpenChange, title, description, icon: Icon, children,
  onSubmit, submitLabel, size = "md", isSubmitting, allowMaximize = false,
}: FormDialogProps) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const toggleMaximize = useCallback(() => setMaximized((m) => !m), []);

  // When maximized, override to full-screen dimensions
  const effectiveSize = maximized ? "full" : size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          SIZES[effectiveSize],
          "p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden",
          maximized && "!w-screen !max-w-screen !h-screen !max-h-screen rounded-none"
        )}
      >
        <DialogHeader className="p-5 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              {Icon && (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
              )}
              {title}
            </DialogTitle>
            {allowMaximize && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={toggleMaximize}
                aria-label={maximized ? "Restore" : "Maximize"}
                title={maximized ? "Restore" : "Maximize"}
              >
                {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            )}
          </div>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        {/*
          Native scroll div for ALL dialog sizes.

          We previously used Radix <ScrollArea> for non-full sizes, but its
          internal viewport wraps children in a `display: table` div that
          does NOT respect the parent flex container's `min-h-0` constraint.
          The viewport expands to the content's natural height (often taller
          than the dialog), overflowing past the dialog's bottom edge and
          intercepting pointer events on the footer below — making the Save
          button unclickable even though it renders visibly.

          Native `overflow-y-auto` inside `flex-1 min-h-0` correctly clamps
          to the available space and scrolls internally. We lose the custom
          scrollbar styling, but the footer stays clickable — a clear win.
        */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5" style={{ minWidth: maximized ? "max-content" : undefined }}>
            {children}
          </div>
        </div>

        {onSubmit && (
          <DialogFooter className="p-4 border-t bg-muted/30 shrink-0">
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
