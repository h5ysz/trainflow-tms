import * as React from "react";

/**
 * Hides content visually while keeping it available to assistive technology.
 *
 * Used for dialog titles that the design shows in another form (e.g. the mobile
 * sidebar, which has its own brand header) but which Radix still requires for the
 * dialog to be correctly labelled.
 */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]">
      {children}
    </span>
  );
}
