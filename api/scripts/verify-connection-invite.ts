import assert from 'node:assert/strict';
import {
  INVITE_DEFAULT_DAYS,
  RateLimiter,
  canStartConnection,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteView,
  isValidInviteTokenShape,
  sanitizePairingPhone,
} from '../services/connectionInvite.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-13T12:00:00Z');

/* ---------------- token ---------------- */
const token = generateInviteToken();
assert.equal(token.length, 43);
assert.ok(isValidInviteTokenShape(token));
assert.equal(new Set(Array.from({ length: 2000 }, generateInviteToken)).size, 2000, 'tokens never repeat');

for (const bad of ['', 'abc', token.slice(1), `${token}x`, token.replace(/.$/, '+'), token.replace(/.$/, '/'), `${token.slice(0, 42)} `, 42, null, undefined, {}]) {
  assert.equal(isValidInviteTokenShape(bad), false, `should reject ${String(bad)}`);
}

const hash = hashInviteToken(token);
assert.match(hash, /^[0-9a-f]{64}$/);
assert.equal(hash, hashInviteToken(token), 'hash is deterministic');
assert.notEqual(hash, hashInviteToken(generateInviteToken()));
assert.ok(!hash.includes(token), 'the token is not recoverable from what is stored for lookup');

/* ---------------- expiry ---------------- */
assert.equal(inviteExpiry(undefined, now)!.getTime(), now.getTime() + INVITE_DEFAULT_DAYS * DAY);
assert.equal(inviteExpiry('', now)!.getTime(), now.getTime() + INVITE_DEFAULT_DAYS * DAY);
assert.equal(inviteExpiry(1, now)!.getTime(), now.getTime() + DAY);
assert.equal(inviteExpiry('30', now)!.getTime(), now.getTime() + 30 * DAY);
for (const bad of [0, -1, 31, 1.5, 'abc', NaN]) assert.equal(inviteExpiry(bad, now), null, `should reject ${String(bad)}`);

/* ---------------- what the person opening the link sees ---------------- */
const future = new Date(now.getTime() + DAY);
const past = new Date(now.getTime() - DAY);

assert.equal(inviteView({ status: 'pending', expiresAt: future }, now), 'ready');
assert.equal(inviteView({ status: 'started', expiresAt: future }, now), 'in_progress');
assert.equal(inviteView({ status: 'pending', expiresAt: past }, now), 'expired');
assert.equal(inviteView({ status: 'started', expiresAt: past }, now), 'expired');
assert.equal(inviteView({ status: 'pending', expiresAt: now }, now), 'expired', 'expires exactly at the limit');
assert.equal(inviteView({ status: 'revoked', expiresAt: future }, now), 'revoked');
assert.equal(inviteView({ status: 'revoked', expiresAt: past }, now), 'revoked');
// a number that got connected keeps showing the thank-you page after the link expires
assert.equal(inviteView({ status: 'connected', expiresAt: past }, now), 'connected');
assert.equal(inviteView({ status: 'connected', expiresAt: future }, now), 'connected');
assert.equal(inviteView({ status: 'pending', expiresAt: future.toISOString() }, now), 'ready', 'accepts ISO strings');

// only usable links can produce a QR code or a pairing code
assert.equal(canStartConnection('ready'), true);
assert.equal(canStartConnection('in_progress'), true);
for (const view of ['connected', 'expired', 'revoked'] as const) assert.equal(canStartConnection(view), false, view);

/* ---------------- pairing phone ---------------- */
assert.equal(sanitizePairingPhone('(11) 91234-5678'), '5511912345678');
assert.equal(sanitizePairingPhone('11 1234-5678'), '551112345678', 'landline length also gets 55');
assert.equal(sanitizePairingPhone('+55 11 91234-5678'), '5511912345678');
assert.equal(sanitizePairingPhone('5511912345678'), '5511912345678');
assert.equal(sanitizePairingPhone('0055 11 91234-5678'), '5511912345678');
assert.equal(sanitizePairingPhone('+1 415 555 2671'), '14155552671', 'with + the number is taken as typed');
assert.equal(sanitizePairingPhone('+351 912 345 678'), '351912345678');
assert.equal(sanitizePairingPhone('14155552671'), null, '11 digits that are not a Brazilian mobile need the + sign');
assert.equal(sanitizePairingPhone('351912345678'), '351912345678', 'already has a country code');
assert.equal(sanitizePairingPhone('11 81234-5678'), null, 'Brazilian 11 digits without the 9 after the area code is not accepted');
assert.equal(sanitizePairingPhone('+55 11 1234'), null, 'too short');
for (const bad of ['', '123', '1199', '12345678901234567', 'abc', null, undefined, 5511912345678]) {
  assert.equal(sanitizePairingPhone(bad), null, `should reject ${String(bad)}`);
}

/* ---------------- rate limiter ---------------- */
const limiter = new RateLimiter(60_000, 3);
const t0 = 1_000_000;
assert.equal(limiter.hit('a', t0).allowed, true);
assert.equal(limiter.hit('a', t0 + 1).allowed, true);
assert.equal(limiter.hit('a', t0 + 2).allowed, true);
const blocked = limiter.hit('a', t0 + 3);
assert.equal(blocked.allowed, false);
assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
assert.equal(limiter.hit('b', t0 + 3).allowed, true, 'keys are independent');
assert.equal(limiter.hit('a', t0 + 60_001).allowed, true, 'a new window starts after the old one ends');

limiter.sweep(t0 + 200_000);
assert.equal(limiter.hit('a', t0 + 200_001).allowed, true, 'sweeping keeps working');

console.log('verify-connection-invite: ok');
