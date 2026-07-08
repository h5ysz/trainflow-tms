"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { QrCode as QrIcon, Download, RefreshCw, Printer, CalendarDays, Clock } from "lucide-react";

export function QrCodeRoute() {
  const { t } = useI18n();
  const [sessionSelected, setSessionSelected] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("qr.title")}
        subtitle={t("qr.subtitle")}
        icon={QrIcon}
      />

      <Card className="p-5">
        <FormGrid cols={2}>
          <Field label={t("attendance.session")} required>
            <Select onValueChange={() => setSessionSelected(true)}>
              <SelectTrigger><SelectValue placeholder={t("qr.selectSession")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>
      </Card>

      {sessionSelected ? (
        <Card className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* QR preview */}
            <div className="flex flex-col items-center justify-center text-center py-6">
              <div className="relative h-64 w-64 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 flex items-center justify-center">
                <QrIcon className="h-32 w-32 text-primary/60" />
              </div>
              <div className="mt-4 text-sm font-mono font-semibold text-primary">TF-{Date.now().toString(36).toUpperCase()}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("qr.token")}</div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t("qr.expiresIn")}
              </div>
            </div>

            {/* Actions & info */}
            <div className="flex flex-col justify-center space-y-4">
              <div>
                <h3 className="text-base font-semibold mb-1">{t("qr.scanInstructions")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("misc.pageUnderConstruction")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="gap-2">
                  <Download className="h-4 w-4" /> {t("qr.download")}
                </Button>
                <Button variant="outline" className="gap-2">
                  <Printer className="h-4 w-4" /> {t("qr.print")}
                </Button>
                <Button variant="outline" className="gap-2 col-span-2">
                  <RefreshCw className="h-4 w-4" /> {t("qr.regenerate")}
                </Button>
              </div>
              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" /> {t("sessions.startDate")}: —
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" /> {t("sessions.endDate")}: —
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState
          icon={QrIcon}
          title={t("qr.selectSession")}
          subtitle={t("qr.subtitle")}
          className="py-12"
        />
      )}
    </div>
  );
}
