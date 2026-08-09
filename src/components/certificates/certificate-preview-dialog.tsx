"use client";

// Certificate preview dialog.
//
// Opens from the certificates list, loads the full certificate, and shows the same
// A4 sheet that gets printed and downloaded as PDF. The Print button renders the
// identical template in a dedicated print layer and calls window.print() — with
// print CSS that hides the rest of the app and sizes the sheet to exactly one
// A4 landscape page.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import { buildVerifyUrl } from "@/lib/qr/urls";
import { CertificateTemplate, type CertificateData } from "./certificate-template";

// A4 landscape sheet in pixels at 96dpi (842 x 595pt). The template sizes itself in
// points (842 x 595), which equals these pixel dimensions, so preview scaling is exact.
const SHEET_W = 1123;
const SHEET_H = 794;

interface FullCertificate {
  id: string;
  refNumber: string;
  traineeName: string;
  finalScore: number | null;
  issuedAt: string | null;
  validUntil: string | null;
  status: string;
  verificationToken: string | null;
  course: { title: string; code: string; durationHours: number | null } | null;
  session: { trainer: { nameEn: string; refNumber: string } | null } | null;
  company: { name: string } | null;
}

export interface CertificatePreviewRow {
  id: string;
  refNumber: string;
  traineeName: string;
}

const PRINT_CSS = `
@media screen {
  #certificate-print-sheet { display: none !important; }
}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; }
  body > * { visibility: hidden !important; }
  #certificate-print-sheet, #certificate-print-sheet * { visibility: visible !important; }
  #certificate-print-sheet { position: fixed !important; left: 0 !important; top: 0 !important; width: 297mm !important; height: 210mm !important; margin: 0 !important; }
}
@page { size: A4 landscape; margin: 0; }
`;

export function CertificatePreviewDialog({
  cert,
  onOpenChange,
  onDownload,
}: {
  cert: CertificatePreviewRow | null;
  onOpenChange: (open: boolean) => void;
  onDownload?: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<CertificateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const open = cert !== null;

  useEffect(() => {
    if (!cert) {
      setData(null);
      setError(null);
      setVerifyUrl("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<FullCertificate>(`/certificates/${cert.id}`)
      .then((c) => {
        if (cancelled) return;
        setData({
          traineeName: c.traineeName,
          courseTitle: c.course?.title ?? "",
          courseCode: c.course?.code ?? "",
          durationHours: c.course?.durationHours ?? null,
          finalScore: c.finalScore,
          issuedAt: c.issuedAt,
          validUntil: c.validUntil,
          refNumber: c.refNumber,
          companyName: c.company?.name ?? null,
          trainerName: c.session?.trainer?.nameEn ?? null,
        });
        setVerifyUrl(
          c.verificationToken ? buildVerifyUrl(window.location.origin, c.verificationToken) : "",
        );
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cert]);

  // Fit the full-size sheet (SHEET_W px) into the dialog width. The template still
  // measures text at full size, so the preview and the print look identical.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / SHEET_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, data]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[min(95vw,1240px)]">
          <DialogHeader>
            <DialogTitle>{t("certificates.previewTitle")}</DialogTitle>
            <DialogDescription>
              {cert ? `${cert.refNumber} — ${cert.traineeName}` : ""}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex h-96 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <div className="overflow-hidden rounded-md border bg-slate-200 p-3">
              <div ref={boxRef} className="w-full" style={{ height: Math.round(SHEET_H * scale) }}>
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: SHEET_W,
                    height: SHEET_H,
                  }}
                >
                  <CertificateTemplate data={data} verifyUrl={verifyUrl} />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={!data} onClick={() => window.print()}>
              <Printer className="h-4 w-4 me-2" />
              {t("certificates.print")}
            </Button>
            <Button disabled={!data || !onDownload} onClick={onDownload}>
              <Download className="h-4 w-4 me-2" />
              {t("certificates.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print layer: the same sheet, full A4 size, the only thing visible on paper. */}
      {open && data && typeof document !== "undefined" &&
        createPortal(
          <>
            <style>{PRINT_CSS}</style>
            <div id="certificate-print-sheet">
              <CertificateTemplate data={data} verifyUrl={verifyUrl} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
