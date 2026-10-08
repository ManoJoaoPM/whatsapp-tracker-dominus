import assert from 'node:assert/strict';
import { getJwtSecret, signAuthToken, verifyAuthToken } from '../config/jwt.js';

// no secret -> no token, and no silent fallback
delete process.env.JWT_SECRET;
assert.throws(() => getJwtSecret(), /JWT_SECRET is required/);
assert.throws(() => signAuthToken('abc'), /JWT_SECRET is required/);

process.env.JWT_SECRET = 'test-secret-for-verification';
const token = signAuthToken('user-1');
assert.deepEqual(verifyAuthToken(token), { id: 'user-1' });

// a token signed with the old hardcoded fallback must be rejected
import jwt from 'jsonwebtoken';
const legacy = jwt.sign({ id: 'user-1' }, 'secret');
assert.throws(() => verifyAuthToken(legacy));
assert.throws(() => verifyAuthToken('not-a-token'));

console.log('verify-jwt: ok');
