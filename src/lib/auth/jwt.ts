// TrainFlow TMS — Auth utilities (JWT via jose, password hashing via WebCrypto)
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import type { UserRole } from "@/lib/auth/permissions";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "trainflow-tms-dev-secret-change-in-production-32bytes!"
);
const JWT_ISSUER = "trainflow-tms";
const JWT_AUDIENCE = "trainflow-users";
const TOKEN_TTL = "7d";

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  fullName: string;
  companyId?: string | null;
  trainerId?: string | null;
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
    };
  } catch {
    return null;
  }
}

// WebCrypto PBKDF2 password hashing (no bcrypt needed)
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH * 8
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufToHex(salt)}$${bufToHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    const salt = hexToBuf(parts[2]);
    const expected = parts[3];
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      KEY_LENGTH * 8
    );
    return bufToHex(new Uint8Array(derived)) === expected;
  } catch {
    return false;
  }
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// Helper: get-or-create demo user for a role (development convenience only)
// NOTE: The clean seed only creates Super Admin. Demo role-login auto-creates
// the other roles' demo accounts on first use so the design-exploration flow
// still works without seeding fake business data.
export async function getOrCreateDemoUser(role: UserRole): Promise<JwtPayload & { id: string }> {
  const demoConfig: Record<UserRole, { email: string; fullName: string }> = {
    SUPER_ADMIN: { email: "admin@trainflow.io", fullName: "System Administrator" },
    COORDINATOR: { email: "coordinator@trainflow.io", fullName: "Sarah Coordinator" },
    TRAINER: { email: "trainer@trainflow.io", fullName: "Ahmed Trainer" },
    CONTRACTOR: { email: "contractor@trainflow.io", fullName: "Khalid Contractor" },
  };
  const cfg = demoConfig[role];

  let user = await db.user.findUnique({ where: { email: cfg.email } });
  if (!user || user.deletedAt) {
    const passwordHash = await hashPassword("trainflow123");
    user = await db.user.create({
      data: {
        email: cfg.email,
        fullName: cfg.fullName,
        role,
        passwordHash,
        language: "en",
        isActive: true,
      },
    });
  }
  return {
    id: user.id,
    sub: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    companyId: user.companyId,
    trainerId: user.trainerId,
  };
}
