import crypto from 'node:crypto';
import type { Db } from '../db/connection.ts';

// Optional PIN lock. It keeps housemates and guests on the same network out of the app;
// it is not a defence against someone who can read the data folder or sniff plain HTTP.

const PIN_KEY = 'auth.pin';
const SECRET_KEY = 'auth.secret';
export const COOKIE = 'mb_session';
export const SESSION_DAYS = 30;

const read = <T>(db: Db, key: string) => {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined;
  return raw === undefined ? null : (JSON.parse(raw) as T);
};
const write = (db: Db, key: string, value: unknown) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));

const hash = (pin: string, salt: string) => crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32).toString('hex');

export const pinEnabled = (db: Db) => read(db, PIN_KEY) !== null;

export function verifyPin(db: Db, pin: string): boolean {
  const stored = read<{ hash: string; salt: string }>(db, PIN_KEY);
  if (!stored) return false;
  return crypto.timingSafeEqual(Buffer.from(hash(pin, stored.salt), 'hex'), Buffer.from(stored.hash, 'hex'));
}

/** Sets or removes the PIN. Either way the signing secret changes, which signs every device out. */
export function setPin(db: Db, pin: string | null) {
  db.transaction(() => {
    if (pin === null) db.prepare('DELETE FROM settings WHERE key = ?').run(PIN_KEY);
    else {
      const salt = crypto.randomBytes(16).toString('hex');
      write(db, PIN_KEY, { hash: hash(pin, salt), salt });
    }
    write(db, SECRET_KEY, crypto.randomBytes(32).toString('hex'));
  })();
}

function secret(db: Db): string {
  let value = read<string>(db, SECRET_KEY);
  if (!value) {
    value = crypto.randomBytes(32).toString('hex');
    write(db, SECRET_KEY, value);
  }
  return value;
}

const sign = (db: Db, expires: number) => crypto.createHmac('sha256', secret(db)).update(String(expires)).digest('hex');

/** A session is just a signed expiry time: nothing to store, and changing the PIN voids them all. */
export function issueToken(db: Db): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return `${expires}.${sign(db, expires)}`;
}

export function validToken(db: Db, token: string | undefined): boolean {
  const [expires, signature] = (token ?? '').split('.');
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const expected = sign(db, Number(expires));
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Slows down guessing: after five wrong PINs in a row, each further miss doubles the wait (30 s up to 15 min). */
export class Throttle {
  private failures = 0;
  private lockedUntil = 0;
  retryAfterSeconds(): number {
    return Math.max(0, Math.ceil((this.lockedUntil - Date.now()) / 1000));
  }
  fail() {
    this.failures++;
    if (this.failures >= 5) this.lockedUntil = Date.now() + Math.min(30 * 2 ** (this.failures - 5), 900) * 1000;
  }
  reset() {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}
