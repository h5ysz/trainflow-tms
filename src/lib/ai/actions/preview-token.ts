// GCCLAB AI Copilot — Phase 2 — Signed preview tokens
// =====================================================================
// The preview→execute flow is two HTTP round-trips. To prevent a malicious
// client from tampering with the params between preview and execute, the
// preview endpoint returns an HMAC-signed token that binds the actionType
// and the hydratedParams. The execute endpoint verifies the token and
// only runs the action if the signature matches.
//
// We use jose (already in the dependency tree for JWT auth) so there are
// no new deps. The secret is the same JWT_SECRET — already required and
// validated at boot.

import { SignJWT, jwtVerify } from "jose";

const RAW_SECRET = process.env.JWT_SECRET;
if (!RAW_SECRET || RAW_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters.");
}
const SECRET = new TextEncoder().encode(RAW_SECRET);
const ISSUER = "gcclab-copilot";
const AUDIENCE = "copilot-action";

export interface PreviewTokenPayload {
  actionType: string;
  hydratedParams: Record<string, unknown>;
  // user id at preview time — execute must be called by the same user
  userId: string;
  // expires in 10 minutes — long enough to read the preview, short enough
  // to limit replay risk
  exp?: number;
}

/**
 * Sign a preview payload with a 10-minute TTL. Returns a compact JWT.
 */
export async function signPreviewToken(
  payload: Omit<PreviewTokenPayload, "exp">
): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("10m")
    .sign(SECRET);
}

/**
 * Verify a preview token. Returns the decoded payload, or null if the
 * signature is invalid / expired / mismatched.
 */
export async function verifyPreviewToken(
  token: string
): Promise<PreviewTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return {
      actionType: payload.actionType as string,
      hydratedParams: payload.hydratedParams as Record<string, unknown>,
      userId: payload.userId as string,
    };
  } catch {
    return null;
  }
}
