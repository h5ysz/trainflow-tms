// Encrypts secret Setting values at rest.
//
// `Setting.value` is a plain TEXT column and `db/custom.db` is tracked in git, so a
// plaintext SMTP password would land in the repository history permanently. Values
// written through here are stored as `enc:v1:<iv>:<tag>:<ciphertext>`, all base64url.
//
// The key comes from SETTINGS_SECRET_KEY — deliberately *not* JWT_SECRET, so that
// rotating sessions (which is a routine security action) doesn't silently break email
// delivery, and so the two can be rotated independently.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

export class SettingsCryptoError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SettingsCryptoError";
    this.code = code;
  }
}

function getKey(): Buffer {
  const secret = process.env.SETTINGS_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new SettingsCryptoError(
      "SETTINGS_SECRET_KEY is not set (or is shorter than 32 characters). It is required to store secret settings.",
      "SETTINGS_KEY_MISSING"
    );
  }
  // SHA-256 turns an arbitrary-length passphrase into the 32 bytes AES-256 needs.
  return createHash("sha256").update(secret).digest();
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * Decrypt a stored secret. Values written before encryption was introduced are returned
 * as-is, so an existing plaintext password keeps working until it is next saved.
 *
 * A value that IS encrypted but cannot be decrypted throws rather than returning empty:
 * silently falling back would leave email "configured" but non-functional, which is the
 * exact class of quiet failure this codebase already suffered from.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext

  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new SettingsCryptoError("Stored secret is malformed", "SETTINGS_VALUE_MALFORMED");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    if (e instanceof SettingsCryptoError) throw e;
    throw new SettingsCryptoError(
      "Stored secret could not be decrypted — SETTINGS_SECRET_KEY has changed. Re-enter the value in Settings.",
      "SETTINGS_KEY_MISMATCH"
    );
  }
}
