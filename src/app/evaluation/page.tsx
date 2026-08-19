// Public evaluation page — accessible via QR code, no login required.
import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/public/public-shell";
import { PublicEvaluationForm } from "@/components/public/public-evaluation-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course Evaluation — GCC Lab",
  robots: { index: false, follow: false },
};

export default function EvaluationPage() {
  return (
    <PublicShell showLocaleToggle>
      <Suspense fallback={<div className="min-h-screen" />}>
        <PublicEvaluationForm />
      </Suspense>
    </PublicShell>
  );
}
