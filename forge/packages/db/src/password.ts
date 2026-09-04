import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify picks the three-argument overload, which drops the cost options we
// depend on. The cast selects the options-bearing signature explicitly.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from the Node standard library, with the cost parameters and salt
 * encoded into the stored string. That format lives here, next to the column
 * it is written into, so raising the cost later is a migration concern rather
 * than a scattered-constants concern — old hashes keep verifying against the
 * parameters they were created with.
 */

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N, r: R, p: P, maxmem: 64 * 1024 * 1024,
  }));
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0) {
    return false;
  }

  const derived = (await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: n, r, p, maxmem: 128 * 1024 * 1024,
  }));

  // Constant-time: a length-dependent early return leaks hash length, and a
  // byte-by-byte compare leaks the prefix.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
