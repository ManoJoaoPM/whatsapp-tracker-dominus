import crypto from 'crypto';

/** Pure helpers of the public connection link (no database, no network) */

export const INVITE_DEFAULT_DAYS = 7;
export const INVITE_MAX_DAYS = 30;
/** Active (not connected, not revoked, not expired) links a company can have at once */
export const MAX_ACTIVE_INVITES = 20;

/** 32 random bytes as base64url: 43 characters, unguessable */
export const generateInviteToken = (): string => crypto.randomBytes(32).toString('base64url');

export const isValidInviteTokenShape = (token: unknown): token is string => {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
};

export const hashInviteToken = (token: string): string => {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
};

export const inviteExpiry = (days: unknown, now: Date = new Date()): Date | null => {
  const n = days === undefined || days === null || days === '' ? INVITE_DEFAULT_DAYS : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > INVITE_MAX_DAYS) return null;
  return new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
};

/** What the person opening the link should see */
export type InviteView = 'ready' | 'in_progress' | 'connected' | 'expired' | 'revoked';

export const inviteView = (
  invite: { status: string; expiresAt: Date | string },
  now: Date = new Date(),
): InviteView => {
  if (invite.status === 'revoked') return 'revoked';
  // A connected number is never "expired": the thank-you page keeps working
  if (invite.status === 'connected') return 'connected';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (invite.status === 'started') return 'in_progress';
  return 'ready';
};

/** Only these views may produce a QR code or a pairing code */
export const canStartConnection = (view: InviteView): boolean => view === 'ready' || view === 'in_progress';

/**
 * Phone number typed by the customer for the pairing code, as digits with country code.
 *
 * - With a leading "+", the number is taken as typed (international format).
 * - Without it, a Brazilian number is assumed when the format fits: mobile = area code + 9 + 8 digits
 *   (11 digits), landline = area code + 8 digits (10 digits). Those get the country code 55.
 * - Anything else must already include the country code (12 to 15 digits).
 */
export const sanitizePairingPhone = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\D+/g, '');

  if (trimmed.startsWith('+')) {
    return digitsOnly.length >= 10 && digitsOnly.length <= 15 ? digitsOnly : null;
  }

  const digits = digitsOnly.startsWith('00') ? digitsOnly.slice(2) : digitsOnly;
  const areaCode = /^[1-9][1-9]/.test(digits);

  if (digits.length === 11 && areaCode && digits[2] === '9') return `55${digits}`;
  if (digits.length === 10 && areaCode) return `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
};

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/** Fixed-window counter. Enough for one server process. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  hit(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.hits.get(key);

    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    current.count += 1;
    if (current.count > this.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** drops expired windows so the map does not grow forever */
  sweep(now: number = Date.now()): void {
    for (const [key, value] of this.hits) {
      if (value.resetAt <= now) this.hits.delete(key);
    }
  }
}
