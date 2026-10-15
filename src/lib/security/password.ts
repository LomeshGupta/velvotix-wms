import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (library default algorithm), OWASP-minimum-class parameters. Tune on target hardware.
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(pw: string): string | undefined {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (pw.length > 128) return "Password is too long";
  return undefined;
}

export const hashPassword = (pw: string): Promise<string> => hash(pw, OPTS);

let dummyHash: Promise<string> | undefined;

/**
 * Constant-ish time: when the user does not exist we still burn one Argon2 verify
 * so response time does not reveal which usernames exist.
 */
export async function verifyPassword(pw: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verify(await dummyHash, pw).catch(() => false);
    return false;
  }
  return verify(storedHash, pw).catch(() => false);
}
