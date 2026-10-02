/**
 * Exact decimal-string money handling.
 *
 * Server balances arrive as decimal strings ("31.40", "0E-16", "5.0000000000000000");
 * they must never round-trip through a binary float, because the pet animates
 * one fen (0.01) at a time and a lost bit would show up as a phantom deduction.
 * Everything here is BigInt integer math: parse to an exact scaled integer,
 * total, then round once to fen with ties away from zero — the same policy the
 * macOS build applies through `NSDecimalRound(.plain)`.
 * @module dsh-vk1-pet/host/money
 */

/** A whole numeric scalar: no surrounding text, no NaN, no Infinity. */
const SCALAR_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Largest magnitude accepted for one wallet, in fen (¥10^12). */
const MAX_FEN = 100_000_000_000_000n;

/**
 * Parse one decimal string into an exact value scaled by 10^scale.
 * @param value - candidate numeric scalar (string or finite number).
 * @returns the signed integer digits and the decimal scale, or null when the
 * input is not an exact decimal scalar.
 */
function parseScaled(value) {
  const text = typeof value === 'string' ? value.trim()
    : typeof value === 'number' && Number.isFinite(value) ? String(value)
      : null;
  if (text === null || !SCALAR_RE.test(text)) return null;

  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match === null) return null;
  const [, sign, intPart = '', fracPart = '', expPart] = match;
  if (intPart === '' && fracPart === '') return null;

  const exponent = expPart === undefined ? 0 : Number(expPart);
  if (!Number.isSafeInteger(exponent)) return null;
  // Keep the arithmetic in a range where both BigInt and Number stay sane: a
  // credential that reports 1e100000 is malformed, not a balance.
  if (Math.abs(exponent) > 400) return null;

  const digits = BigInt(`${intPart}${fracPart}` === '' ? '0' : `${intPart}${fracPart}`);
  const scale = fracPart.length - exponent;
  return { negative: sign === '-', digits, scale };
}

/** 10^n as BigInt. */
function pow10(n) {
  return 10n ** BigInt(n);
}

/**
 * Round an exact scaled integer to whole fen, ties away from zero.
 * @param scaled - exact `{ negative, digits, scale }` value.
 * @returns signed fen as BigInt, or null when the value overflows the accepted range.
 */
function scaledToFen(scaled) {
  const { negative, digits, scale } = scaled;
  const shift = 2 - scale;
  let fen;
  if (shift >= 0) {
    fen = digits * pow10(shift);
  } else {
    const divisor = pow10(-shift);
    fen = digits / divisor;
    const remainder = digits % divisor;
    if (remainder * 2n >= divisor) fen += 1n;
  }
  if (fen > MAX_FEN) return null;
  return negative ? -fen : fen;
}

/**
 * Convert one server decimal string to fen.
 * @param value - server amount, as a decimal string or finite number.
 * @returns signed whole fen, or null when the value is malformed or out of range.
 */
export function decimalToFen(value) {
  const scaled = parseScaled(value);
  if (scaled === null) return null;
  return scaledToFen(scaled);
}

/**
 * Render fen as the fixed two-decimal string the tablet shows.
 * @param fen - signed whole fen.
 * @returns the display string, e.g. `31.40` or `-0.05`.
 */
export function fenToString(fen) {
  const magnitude = fen < 0n ? -fen : fen;
  const fraction = magnitude % 100n;
  const whole = magnitude / 100n;
  return `${fen < 0n ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Total the CNY entries of one wallet array.
 *
 * This UI is denominated in ¥, so a USD amount is skipped rather than relabelled.
 * The original macOS build rejects a required list that carries no CNY wallet at
 * all, which is what keeps a currency mismatch loud instead of silently zero.
 * @param wallets - raw wallet array from the server.
 * @param options - `required` fails when the list is missing; `amountKey` names
 * the amount field (the API-key envelope uses `total_balance`).
 * @returns the summed fen, or `{ error }` describing a malformed payload.
 */
export function sumCnyWallets(wallets, { required, amountKey = 'balance' } = {}) {
  if (wallets === undefined || wallets === null) {
    return required ? { error: '找不到钱包数组' } : { fen: 0n, count: 0 };
  }
  if (!Array.isArray(wallets)) return { error: '钱包字段必须是数组' };

  let fen = 0n;
  let count = 0;
  for (const wallet of wallets) {
    if (wallet === null || typeof wallet !== 'object') return { error: '钱包条目不是对象' };
    const currency = wallet.currency;
    if (typeof currency !== 'string' || currency.length === 0) return { error: '钱包缺少货币类型' };
    if (currency !== 'CNY') continue;
    const amount = decimalToFen(wallet[amountKey]);
    if (amount === null) return { error: 'CNY 金额无效或超出范围' };
    fen += amount;
    if (fen > MAX_FEN || fen < -MAX_FEN) return { error: '金额合计超出范围' };
    count += 1;
  }
  if (count === 0) return { error: '没有 CNY 钱包，暂不支持其他货币' };
  return { fen, count };
}

/**
 * Parse a `Retry-After` header (delta-seconds or an HTTP date).
 * @param value - raw header value, if any.
 * @param now - current time in milliseconds.
 * @returns whole seconds to wait, capped at 24 hours, or null when unusable.
 */
export function retryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? Math.min(86_400, seconds) : null;
  }
  // Only an RFC-style date reaches the parser: `Date.parse('-5')` happily reads
  // as a year, which would turn a malformed header into a bogus wait.
  if (!/^[A-Za-z]{3}/.test(raw)) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(86_400, Math.max(0, Math.round((parsed - now) / 1000)));
}
