"use client";

// Worker Passport View — mobile-friendly public component.
// Rendered server-side via /worker/[token]/page.tsx when QR is scanned.
interface CertificateInfo {
  refNumber: string;
  courseCode: string;
  courseTitle: string;
  issuedAt: string;
  validUntil: string;
  status: string;
  finalScore: number;
  trainerName: string | null;
}

interface ComplianceInfo {
  compliancePercent: number;
  level: "GREEN" | "ORANGE" | "RED";
  totalRequired: number;
  totalCompleted: number;
  totalMissing: number;
  totalExpired: number;
  totalExpiringSoon: number;
  requirements: Array<{
    courseCode: string;
    courseTitle: string;
    status: "VALID" | "EXPIRED" | "EXPIRING_SOON" | "MISSING";
    isCoreMandatory: boolean;
    hasValidCertificate: boolean;
  }>;
}

export function WorkerPassportView({
  passport,
  compliance,
  certificates,
}: {
  passport: {
    passportNumber: string;
    fullName: string;
    companyName: string | null;
    jobTitle: string | null;
  };
  compliance: ComplianceInfo;
  certificates: CertificateInfo[];
}) {
  const levelColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    GREEN: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", label: "Compliant" },
    ORANGE: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", label: "Partial" },
    RED: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "Non-Compliant" },
  };
  const levelColor = levelColors[compliance.level];

  const now = new Date();
  const activeCerts = certificates.filter((c) => {
    const diff = new Date(c.validUntil).getTime() - now.getTime();
    return diff > 60 * 24 * 60 * 60 * 1000 && c.status !== "EXPIRED" && c.status !== "REVOKED";
  });
  const expiredCerts = certificates.filter((c) => {
    const diff = new Date(c.validUntil).getTime() - now.getTime();
    return diff < 0;
  });
  const expiringSoonCerts = certificates.filter((c) => {
    const diff = new Date(c.validUntil).getTime() - now.getTime();
    return diff >= 0 && diff <= 60 * 24 * 60 * 60 * 1000;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-4 px-3 sm:py-8 sm:px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#7B1E2B]">GCCLAB</h1>
              <p className="text-xs text-gray-500">Worker Training Passport</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Passport #</p>
              <p className="text-sm font-mono font-semibold">{passport.passportNumber}</p>
            </div>
          </div>

          {/* Worker Info */}
          <div className="border-t pt-4">
            <h2 className="text-lg font-semibold text-gray-900">{passport.fullName}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-sm">
              {passport.companyName && (
                <div>
                  <span className="text-gray-500">Company:</span>{" "}
                  <span className="font-medium">{passport.companyName}</span>
                </div>
              )}
              {passport.jobTitle && (
                <div>
                  <span className="text-gray-500">Job Title:</span>{" "}
                  <span className="font-medium">{passport.jobTitle}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Compliance Score */}
        <div className={`rounded-lg shadow-md p-4 sm:p-6 mb-4 border-2 ${levelColor.bg} ${levelColor.border}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Compliance Score</p>
              <p className={`text-3xl sm:text-4xl font-bold ${levelColor.text}`}>
                {compliance.compliancePercent}%
              </p>
              <p className={`text-sm font-medium ${levelColor.text}`}>{levelColor.label}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-600">
                {compliance.totalCompleted} / {compliance.totalRequired} mandatory courses
              </p>
              <p className="text-gray-500 text-xs mt-1">
                ✅ {compliance.totalCompleted} Valid · ⚠ {compliance.totalExpiringSoon} Expiring · ✗ {compliance.totalExpired} Expired · ○ {compliance.totalMissing} Missing
              </p>
            </div>
          </div>
        </div>

        {/* Certificate Summary */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{activeCerts.length}</p>
            <p className="text-xs text-gray-500">Active</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{expiringSoonCerts.length}</p>
            <p className="text-xs text-gray-500">Expiring Soon</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{expiredCerts.length}</p>
            <p className="text-xs text-gray-500">Expired</p>
          </div>
        </div>

        {/* Required Courses */}
        {compliance.requirements.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Required Courses</h3>
            <div className="space-y-2">
              {compliance.requirements.map((req) => {
                const statusConfig: Record<string, { color: string; icon: string }> = {
                  VALID: { color: "text-green-600", icon: "✅" },
                  EXPIRING_SOON: { color: "text-orange-600", icon: "⚠" },
                  EXPIRED: { color: "text-red-600", icon: "✗" },
                  MISSING: { color: "text-gray-400", icon: "○" },
                };
                const cfg = statusConfig[req.status] ?? statusConfig.MISSING;
                return (
                  <div key={req.courseCode} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={cfg.color}>{cfg.icon}</span>
                      <span className="font-medium">{req.courseTitle}</span>
                      {req.isCoreMandatory && (
                        <span className="text-[10px] bg-red-50 text-red-600 px-1 rounded">CORE</span>
                      )}
                    </div>
                    <span className={`text-xs ${cfg.color}`}>
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Certificate History */}
        {certificates.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Certificate History</h3>
            <div className="space-y-3">
              {certificates.map((cert) => {
                const isExpired = new Date(cert.validUntil) < now;
                return (
                  <div key={cert.refNumber} className="border-b pb-2 last:border-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium">{cert.courseTitle}</p>
                        <p className="text-xs text-gray-500 font-mono">{cert.refNumber}</p>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          isExpired
                            ? "bg-red-50 text-red-600"
                            : "bg-green-50 text-green-600"
                        }`}
                      >
                        {isExpired ? "Expired" : "Valid"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                      <span>Issued: {new Date(cert.issuedAt).toLocaleDateString()}</span>
                      <span>Expiry: {new Date(cert.validUntil).toLocaleDateString()}</span>
                      <span>Score: {cert.finalScore}%</span>
                      {cert.trainerName && <span>Trainer: {cert.trainerName}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-gray-400">
          <p>This passport was generated by GCCLAB (Gulf Calibration Laboratory).</p>
          <p>Verify certificate authenticity at training.gcclab.com/verify</p>
        </div>
      </div>
    </div>
  );
}
