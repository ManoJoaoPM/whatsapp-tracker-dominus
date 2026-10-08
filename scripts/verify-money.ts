import assert from 'node:assert/strict';
import { formatMoney, parseMoneyInput } from '../src/lib/money';

// Brazilian formats
assert.equal(parseMoneyInput('1500'), 1500);
assert.equal(parseMoneyInput('1.500'), 1500);
assert.equal(parseMoneyInput('1.500,00'), 1500);
assert.equal(parseMoneyInput('R$ 1.500,50'), 1500.5);
assert.equal(parseMoneyInput('1500,5'), 1500.5);
assert.equal(parseMoneyInput('480.000'), 480000);
assert.equal(parseMoneyInput('0,99'), 0.99);
assert.equal(parseMoneyInput('  2.350.000,00 '), 2350000);

// Not amounts
assert.equal(parseMoneyInput(''), null);
assert.equal(parseMoneyInput('abc'), null);
assert.equal(parseMoneyInput('0'), null);
assert.equal(parseMoneyInput('0,00'), null);
assert.equal(parseMoneyInput('9999999999'), null, 'above the cap');

assert.match(formatMoney(1500), /1\.500,00/);

console.log('verify-money: ok');
