// Public QR check-in page.
//
// `/api/sessions/[id]/qr` has always returned `checkInUrl: "/check-in?token=…"`, but the
// page never existed — so the QR attendance module was unreachable end to end. This is
// that page: no login, addressed purely by the token in the QR.
import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/public/public-shell";
import { CheckInForm } from "@/components/public/check-in-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Session Check-in — GCC Lab",
  robots: { index: false, follow: false },
};

export default function CheckInPage() {
  return (
    <PublicShell showLocaleToggle>
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<div className="min-h-screen" />}>
        <CheckInForm />
      </Suspense>
    </PublicShell>
  );
}
