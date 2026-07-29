// /api/public/check-in — unauthenticated QR attendance
//
// Deliberately namespaced under /api/public so the trust boundary is obvious. The QR
// token is the credential: it is 128 bits of randomness (randomBytes(16)), so guessing
// is not a threat model — the real controls are the session's QR activity window,
// rate limiting, and the duplicate check.
//
// This replaces /api/sessions/[id]/check-in, which called getCurrentUser() and so 401'd
// for exactly the person it was meant to serve, and which had no frontend caller at all.
// Staff-side check-in continues to go through POST /api/attendance.
import { ok, created, fail } from "@/lib/auth/api";
import { checkRateLimit, clientIp } from "@/lib/api/rate-limit";
import {
  performCheckIn,
  findSessionByQrToken,
  windowState,
  qrWindow,
  recentFailureCount,
  CheckInError,
} from "@/lib/sessions/check-in-service";

const MAX_RECENT_FAILURES = 20;

/** GET ?token=… — the minimum the check-in form needs to render. */
export async function GET(req: Request) {
  const rl = checkRateLimit(req, "public:check-in:get", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests. Please wait a moment.", 429, "RATE_LIMITED");

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return fail("A check-in link token is required", 400, "VALIDATION_ERROR");

  const session = await findSessionByQrToken(token);
  if (!session) return fail("This check-in link is not valid.", 404, "INVALID_QR");

  const { from, to } = qrWindow(session);

  // Anonymous callers get a deliberately narrow projection: enough to confirm they are
  // at the right session, and nothing about who else is attending it.
  return ok({
    sessionTitle: session.title,
    courseTitle: session.course?.title ?? null,
    startDate: session.startDate,
    endDate: session.endDate,
    city: session.city,
    venue: session.venue,
    windowState: windowState(session),
    qrActiveFrom: from,
    qrActiveTo: to,
    spotsRemaining: Math.max(0, session.capacity - session.actualTrainees),
  });
}

export async function POST(req: Request) {
  const rl = checkRateLimit(req, "public:check-in", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return fail("Too many check-in attempts. Please wait a moment.", 429, "RATE_LIMITED");
  }

  const ipAddress = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  // Database-backed backstop: the in-memory limiter above resets whenever the process
  // restarts, which on a free-tier host is frequently.
  if ((await recentFailureCount(ipAddress)) > MAX_RECENT_FAILURES) {
    return fail("Too many failed attempts from this device. Please try again later.", 429, "RATE_LIMITED");
  }

  const body = await req.json().catch(() => ({}));
  const qrCodeToken = typeof body.qrCodeToken === "string" ? body.qrCodeToken : "";
  const traineeName = typeof body.traineeName === "string" ? body.traineeName.trim() : "";

  if (!qrCodeToken || !traineeName) {
    return fail("Your name and a valid check-in link are required", 422, "VALIDATION_ERROR");
  }
  if (traineeName.length > 120) {
    return fail("Name is too long", 422, "VALIDATION_ERROR");
  }

  try {
    const result = await performCheckIn(
      {
        qrCodeToken,
        traineeName,
        traineeIdNational: typeof body.traineeIdNational === "string" ? body.traineeIdNational : undefined,
        traineeEmail: typeof body.traineeEmail === "string" ? body.traineeEmail : undefined,
        traineePhone: typeof body.traineePhone === "string" ? body.traineePhone : undefined,
        company: typeof body.company === "string" ? body.company : undefined,
        deviceFingerprint: typeof body.deviceFingerprint === "string" ? body.deviceFingerprint : undefined,
      },
      { actorUserId: null, source: "PUBLIC_QR", ipAddress, userAgent, req }
    );

    // Trimmed projection — the old handler returned the whole attendance row, including
    // deviceInfo and companyId, to an anonymous caller.
    return created({
      checkInAt: result.checkInAt,
      status: result.status,
      preTestAssigned: result.preTestAssigned,
      session: result.session,
    });
  } catch (e) {
    if (e instanceof CheckInError) {
      // A duplicate is a friendly outcome, not a failure: the trainee is checked in.
      const status = e.code === "DUPLICATE_CHECK_IN" ? 409 : 400;
      return fail(e.message, status, e.code, e.details);
    }
    console.error("[public check-in]", e);
    return fail("Check-in could not be completed. Please ask your trainer for help.", 500);
  }
}
