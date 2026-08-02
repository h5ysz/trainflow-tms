"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export interface PasswordInputProps extends React.ComponentProps<"input"> {
  /** Optional: override the default show/hide labels from i18n. */
  showLabel?: string;
  hideLabel?: string;
}

/**
 * Password input with a built-in show/hide toggle.
 *
 * Features:
 * - Default: password is hidden (type="password").
 * - Eye icon on the end (right in LTR, left in RTL) side of the input.
 * - Click toggles between hidden/visible.
 * - Icon changes: Eye (hidden) → EyeOff (visible).
 * - Accessible: aria-label on the toggle button, keyboard focusable.
 * - RTL compatible: uses absolute positioning that works in both directions.
 * - Mobile compatible: the toggle button has a generous tap target.
 * - Does NOT clear the password when toggled.
 * - Does NOT affect validation — the underlying input retains its value,
 *   name, onChange, and all other props.
 *
 * Usage:
 *   <PasswordInput value={pwd} onChange={...} placeholder="••••••••" />
 *
 * Or as a drop-in replacement for <Input type="password" ... />:
 *   // Before:  <Input type="password" value={pwd} onChange={...} />
 *   // After:   <PasswordInput value={pwd} onChange={...} />
 */
function PasswordInput({
  className,
  showLabel,
  hideLabel,
  ...props
}: PasswordInputProps) {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);

  const label = visible
    ? hideLabel || t("auth.hidePassword") || "Hide password"
    : showLabel || t("auth.showPassword") || "Show password";

  return (
    <div className="relative w-full">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pe-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label={label}
        aria-pressed={visible}
        tabIndex={0}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
