import assert from 'node:assert/strict';
import test from 'node:test';

import { decimalToFen, fenToString, retryAfterSeconds, sumCnyWallets } from '../host/money.js';

test('decimalToFen keeps exact decimal values', () => {
  assert.equal(decimalToFen('31.40'), 3140n);
  assert.equal(decimalToFen('0.01'), 1n);
  assert.equal(decimalToFen('0'), 0n);
  assert.equal(decimalToFen('5.0000000000000000'), 500n);
  assert.equal(decimalToFen('0E-16'), 0n);
  assert.equal(decimalToFen('.5'), 50n);
  assert.equal(decimalToFen('1e2'), 10000n);
  assert.equal(decimalToFen('-3.005'), -301n, 'ties round away from zero');
  assert.equal(decimalToFen(12.34), 1234n);
});

test('decimalToFen refuses anything that is not an exact scalar', () => {
  for (const value of ['', ' ', 'abc', '1,2', 'NaN', 'Infinity', '1.2.3', '1 2', null, undefined, {}, '1e999']) {
    assert.equal(decimalToFen(value), null, `expected ${String(value)} to be refused`);
  }
});

test('fenToString renders two decimals', () => {
  assert.equal(fenToString(3140n), '31.40');
  assert.equal(fenToString(5n), '0.05');
  assert.equal(fenToString(-5n), '-0.05');
  assert.equal(fenToString(0n), '0.00');
});

test('sumCnyWallets ignores other currencies but refuses a list with no CNY', () => {
  const mixed = sumCnyWallets([
    { currency: 'USD', total_balance: '9.99' },
    { currency: 'CNY', total_balance: '31.40' },
  ], { required: true, amountKey: 'total_balance' });
  assert.deepEqual(mixed, { fen: 3140n, count: 1 });

  const usdOnly = sumCnyWallets([{ currency: 'USD', total_balance: '9.99' }], { required: true, amountKey: 'total_balance' });
  assert.equal(usdOnly.error, '没有 CNY 钱包，暂不支持其他货币');
});

test('sumCnyWallets treats an absent bonus list as zero but a required list as an error', () => {
  assert.deepEqual(sumCnyWallets(undefined, { required: false }), { fen: 0n, count: 0 });
  assert.equal(sumCnyWallets(undefined, { required: true }).error, '找不到钱包数组');
});

test('sumCnyWallets reports a malformed wallet', () => {
  assert.equal(sumCnyWallets([{ currency: 'CNY' }], { required: true }).error, 'CNY 金额无效或超出范围');
  assert.equal(sumCnyWallets([null], { required: true }).error, '钱包条目不是对象');
  assert.equal(sumCnyWallets([{ balance: '1' }], { required: true }).error, '钱包缺少货币类型');
});

test('retryAfterSeconds understands seconds and HTTP dates', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(retryAfterSeconds('12', now), 12);
  assert.equal(retryAfterSeconds(' 7 ', now), 7);
  assert.equal(retryAfterSeconds('999999', now), 86_400);
  assert.equal(retryAfterSeconds('Thu, 01 Jan 2026 00:00:30 GMT', now), 30);
  assert.equal(retryAfterSeconds('not a date', now), null);
  assert.equal(retryAfterSeconds(undefined, now), null);
  assert.equal(retryAfterSeconds('-5', now), null, 'a negative delta is not a date');
  assert.equal(retryAfterSeconds('2026-01-01', now), null, 'a bare ISO date is not an HTTP date');
});
