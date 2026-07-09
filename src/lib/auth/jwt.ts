// GCCLAB TMS — Auth utilities (JWT via jose, password hashing via WebCrypto)
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/lib/auth/permissions";

// JWT_SECRET is required — no insecure fallback. Fail fast at module load
// so the process refuses to boot rather than silently signing tokens with a
// well-known key that anyone could forge.
const RAW_JWT_SECRET = process.env.JWT_SECRET;
if (!RAW_JWT_SECRET || RAW_JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET environment variable is required and must be at least 32 characters. " +
      "Generate one with: openssl rand -hex 32"
  );
}
const JWT_SECRET = new TextEncoder().encode(RAW_JWT_SECRET);
const JWT_ISSUER = "gcclab-tms";
const JWT_AUDIENCE = "trainflow-users";
const TOKEN_TTL = "7d";

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  fullName: string;
  companyId?: string | null;
  trainerId?: string | null;
  tokenVersion?: number; // bumped server-side to revoke all outstanding sessions
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(TOKEN_TTL)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as UserRole,
      fullName: payload.fullName as string,
      companyId: (payload.companyId as string | null) ?? null,
      trainerId: (payload.trainerId as string | null) ?? null,
      tokenVersion: (payload.tokenVersion as number | undefined) ?? 0,
    };
  } catch {
    return null;
  }
}

// WebCrypto PBKDF2 password hashing (no bcrypt needed)
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const { randomBytes, pbkdf2Sync } = await import("node:crypto");
  const salt = randomBytes(SALT_LENGTH);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expected = parts[3];

    const { pbkdf2Sync, timingSafeEqual } = await import("node:crypto");
    const saltBuffer = Buffer.from(saltHex, "hex");
    const derived = pbkdf2Sync(password, saltBuffer, iterations, KEY_LENGTH, "sha256");
    const expectedBuffer = Buffer.from(expected, "hex");

    // Constant-time comparison to avoid leaking hash bytes via timing.
    if (derived.length !== expectedBuffer.length) return false;
    return timingSafeEqual(derived, expectedBuffer);
  } catch (e) {
    console.error("[verifyPassword error]", e);
    return false;
  }
}

