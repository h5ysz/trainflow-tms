// Public final-test page — accessible via QR code, no login required.
import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/public/public-shell";
import { PublicExamForm } from "@/components/public/public-exam-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Final Test — GCC Lab",
  robots: { index: false, follow: false },
};

export default function FinalTestPage() {
  return (
    <PublicShell showLocaleToggle>
      <Suspense fallback={<div className="min-h-screen" />}>
        <PublicExamForm testType="FINAL_TEST" />
      </Suspense>
    </PublicShell>
  );
}
