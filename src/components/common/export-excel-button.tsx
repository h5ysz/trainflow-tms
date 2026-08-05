"use client";

/**
 * <ExportExcelButton /> — Universal single-request Excel export action.
 *
 * One reusable button used everywhere a request can be viewed:
 *   • Coordinator / Admin inline toolbar (single-selection)
 *   • Read-only Preview dialog (the contractor's main view of a request)
 *   • Any future surface that needs to export a single request to Excel
 *
 * RBAC is enforced by the underlying API (`/api/export/company-data`):
 *   • Contractor  → server auto-scopes to `user.companyId` (own company only)
 *   • Coordinator → sees all companies' requests
 *   • Admin       → sees everything
 *   • Any role without `requests.view` is blocked at the route-entry level
 *     by `canAccessModule` in the router; the button never renders for them.
 *
 * No API / template / business-logic duplication — this component only builds
 * the query string and opens the existing export endpoint in a new tab.
 */

import * as React from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";

export interface ExportExcelButtonProps {
  /** The request ID to export. Required — this button always exports ONE request. */
  requestId: string;
  /** Visual variant. Defaults to `"outline"` to match the existing toolbar button. */
  variant?: React.ComponentProps<typeof Button>["variant"];
  /** Button size. Defaults to `"sm"` to match the existing toolbar button. */
  size?: React.ComponentProps<typeof Button>["size"];
  /** Show the text label. Defaults to `true`. Set `false` for an icon-only button. */
  showLabel?: boolean;
  /** Extra className. */
  className?: string;
  /** Optional disabled flag. */
  disabled?: boolean;
}

const ALL_ITEMS = [
  "requests",
  "trainees",
  "attendance",
  "results",
  "evaluations",
  "certificates",
  "invoices",
  "attachments",
].join(",");

export function ExportExcelButton({
  requestId,
  variant = "outline",
  size = "sm",
  showLabel = true,
  className,
  disabled,
}: ExportExcelButtonProps) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const handleClick = React.useCallback(() => {
    if (!requestId || loading) return;

    setLoading(true);

    try {
      const params = new URLSearchParams({
        scope: "specific_request",
        specificId: requestId,
        items: ALL_ITEMS,
        format: "excel",
        locale,
      });
      // The API does the actual work — server-side RBAC enforces the
      // companyId scoping for contractors. The browser receives the
      // .xlsx file as a download in a new tab.
      window.open(`/api/export/company-data?${params.toString()}`, "_blank");

      toast({
        title: t("misc.success"),
        description: t("requests.exportStarted"),
      });
    } catch {
      toast({
        title: t("misc.error"),
        description: t("requests.exportFailed"),
        variant: "destructive",
      });
    } finally {
      // Brief feedback window — the actual download happens in the new tab.
      // Keep the spinner visible long enough to be perceived as "action taken".
      window.setTimeout(() => setLoading(false), 350);
    }
  }, [requestId, loading, locale, t, toast]);

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled || loading || !requestId}
      title={t("requests.exportExcelTooltip")}
      aria-label={t("reports.exportExcel")}
      className={className}
    >
      {loading ? (
        <Loader2 className={`${iconSize} me-1.5 animate-spin`} />
      ) : (
        <FileSpreadsheet className={`${iconSize} me-1.5`} />
      )}
      {showLabel && t("reports.exportExcel")}
    </Button>
  );
}
