// Public certificate verification page.
//
// This is the URL printed (and now QR-encoded) on every generated certificate. It did
// not exist: generate-pdf emitted `${origin}/verify/${token}` while the only real
// endpoint was `GET /api/certificates/verify?token=`, so every issued certificate
// carried a link that 404'd.
//
// It queries directly rather than fetching its own API — that avoids guessing the
// server's own base URL under the standalone build, and keeps the verification counter
// from being incremented twice for a single visit.
import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  lookupCertificate,
  computeValidity,
  recordVerification,
  publicCertificateView,
} from "@/lib/certificates/verify";
import { checkRateLimitByIp } from "@/lib/api/rate-limit";
import { PublicShell } from "@/components/public/public-shell";
import { VerifyResult, type PublicCertificate } from "@/components/public/verify-result";

// Writes on view (the verification log), so it must never be cached or prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify Certificate — GCC Lab",
  robots: { index: false, follow: false },
};

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const decodedToken = decodeURIComponent(token);

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0].trim() ?? headerList.get("x-real-ip") ?? "unknown";

  // Guessing tokens is infeasible (128 bits of randomness), but this keeps the page
  // from being usable as a free scraping endpoint.
  const rl = checkRateLimitByIp(ip, "verify:page", { limit: 30, windowMs: 60_000 });

  const cert = rl.ok ? await lookupCertificate(decodedToken) : null;
  const validity = computeValidity(cert);

  if (cert) {
    await recordVerification({
      certificateId: cert.id,
      token: decodedToken,
      ipAddress: ip,
      userAgent: headerList.get("user-agent"),
      channel: "WEB",
    });
  }

  // Dates cross the server/client boundary as ISO strings.
  const certificate: PublicCertificate | null = cert
    ? (() => {
        const view = publicCertificateView(cert);
        return {
          ...view,
          issuedAt: view.issuedAt.toISOString(),
          validUntil: view.validUntil.toISOString(),
        };
      })()
    : null;

  return (
    <PublicShell showLocaleToggle>
      <VerifyResult validity={validity} certificate={certificate} />
    </PublicShell>
  );
}
