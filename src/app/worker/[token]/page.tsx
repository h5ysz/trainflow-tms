// Public Worker Training Passport page — accessed via QR code scan.
// URL: /worker/{qrToken}
//
// This page is server-rendered (no auth required) and mobile-friendly.
// It fetches the passport data directly from the DB (not via API) to
// avoid double-counting and ensure fast load (< 2 seconds).
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { calculateCompliance } from "@/lib/worker/compliance-engine";
import { WorkerPassportView } from "@/components/public/worker-passport-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Worker Training Passport — GCCLAB",
  description: "Worker Training Passport & Compliance Status",
  robots: { index: false, follow: false },
};

export default async function WorkerPassportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const passport = await db.workerPassport.findUnique({
    where: { qrToken: token },
    include: {
      company: { select: { id: true, name: true } },
    },
  });

  if (!passport || passport.deletedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Passport Not Found</h1>
          <p className="text-gray-600">
            This worker passport QR code is invalid or has been deactivated.
          </p>
        </div>
      </div>
    );
  }

  // Fetch certificates
  const certificates = await db.certificate.findMany({
    where: {
      workerPassportId: passport.id,
      deletedAt: null,
      status: { not: "REVOKED" },
    },
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
      session: {
        select: {
          id: true,
          refNumber: true,
          startDate: true,
          endDate: true,
          trainer: { select: { fullName: true } },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });

  const compliance = await calculateCompliance(
    { nationalId: passport.nationalId, companyId: passport.companyId, jobTitle: passport.jobTitle },
    certificates
  );

  return (
    <WorkerPassportView
      passport={{
        passportNumber: passport.passportNumber,
        fullName: passport.fullName,
        companyName: passport.company?.name ?? null,
        jobTitle: passport.jobTitle,
      }}
      compliance={compliance}
      certificates={certificates.map((c) => ({
        refNumber: c.refNumber,
        courseCode: c.course.code,
        courseTitle: c.course.title,
        issuedAt: c.issuedAt.toISOString(),
        validUntil: c.validUntil.toISOString(),
        status: c.status,
        finalScore: c.finalScore,
        trainerName: c.session.trainer?.fullName ?? null,
      }))}
    />
  );
}
