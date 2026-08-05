"use client";

import * as React from "react";
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
  /** Secondary action button (e.g. "Submit" alongside "Save"). When provided,
   * renders a primary button to the right of the main submit button. */
  onSubmitSecondary?: () => void;
  submitSecondaryLabel?: string;
  size?: "sm" | "md" | "lg" | "xl" | "xxl" | "3xl";
  isSubmitting?: boolean;
  /** Optional footer rendered on the LEFT of the standard Cancel/Save buttons. */
  footerExtra?: React.ReactNode;
  /** When true, shows a Maximize/Restore button in the header that expands the
   * dialog to ~98vw × 96vh. Useful for dialogs with large tables (e.g. the
   * New Training Request dialog with the trainee entry grid). */
  allowFullscreen?: boolean;
}

const SIZES: Record<NonNullable<FormDialogProps["size"]>, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  xxl: "sm:max-w-7xl",
  // 3xl = almost full screen by default — for the New Training Request
  // dialog which contains a large editable trainee grid + additional docs.
  "3xl": "sm:max-w-[95vw] sm:w-[95vw]",
};

export function FormDialog({
  open, onOpenChange, title, description, icon: Icon, children,
  onSubmit, submitLabel, onSubmitSecondary, submitSecondaryLabel,
  size = "md", isSubmitting, footerExtra,
  allowFullscreen = false,
}: FormDialogProps) {
  const { t } = useI18n();
  const [fullscreen, setFullscreen] = React.useState(false);

  // Reset fullscreen when the dialog closes so the next open starts normal.
  React.useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  // When fullscreen, override the size classes to fill the viewport.
  // The DialogContent uses translate-x/y-[-50%] + fixed positioning, so we
  // can't use percentage heights relative to the viewport inside it. Instead
  // we use fixed vw/vh units on the content itself, and flex layout so the
  // ScrollArea fills the space between the header and footer.
  // Note: the base DialogContent has `grid gap-4 sm:max-w-lg` — we override
  // with `flex flex-col` and the size-specific `sm:max-w-*`. tailwind-merge
  // (via cn) ensures our classes win over the base ones.
  const contentClassName = cn(
    "p-0 gap-0 overflow-hidden flex flex-col",
    fullscreen
      ? "max-w-[98vw] w-[98vw] max-h-[96vh] h-[96vh]"
      : cn(SIZES[size], "max-h-[90vh]")
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <DialogHeader className="p-5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            {Icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
            )}
            {title}
            {allowFullscreen && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ms-auto h-7 px-2"
                onClick={() => setFullscreen((v) => !v)}
                title={fullscreen ? t("requests.fullscreenExit") : t("requests.fullscreen")}
                aria-label={fullscreen ? t("requests.fullscreenExit") : t("requests.fullscreen")}
              >
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span className="hidden sm:inline ms-1">
                  {fullscreen ? t("requests.fullscreenExit") : t("requests.fullscreen")}
                </span>
              </Button>
            )}
          </DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        {/* Body — flex-1 so it fills the space between header and footer.
            When fullscreen, use min-h-0 so the flex child can shrink and
            the inner scroll works. The max-h classes are only applied in
            non-fullscreen mode (in fullscreen, the flex layout handles sizing). */}
        <div className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          !fullscreen && (size === "3xl" ? "max-h-[82vh]" : size === "xxl" ? "max-h-[75vh]" : "max-h-[60vh]")
        )}>
          <div className="p-5">
            {children}
          </div>
        </div>

        {(onSubmit || footerExtra) && (
          <DialogFooter className="p-4 border-t bg-muted/30 flex items-center justify-between gap-2 shrink-0">
            <div className="flex-shrink-0">{footerExtra}</div>
            <div className="flex items-center gap-2 ms-auto">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {t("action.cancel")}
              </Button>
              {onSubmit && (
                <Button onClick={onSubmit} disabled={isSubmitting}>
                  {isSubmitting ? t("misc.saving") : (submitLabel ?? t("action.save"))}
                </Button>
              )}
              {onSubmitSecondary && (
                <Button variant="default" onClick={onSubmitSecondary} disabled={isSubmitting}>
                  {isSubmitting ? t("misc.saving") : (submitSecondaryLabel ?? "Submit")}
                </Button>
              )}
            </div>
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
