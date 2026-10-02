/**
 * Credential resolution and balance reads for the DSH harness home.
 *
 * Two credential shapes reach this module, in the order the original macOS pet
 * used:
 *
 * 1. an API key (`DEEPSEEK_API_KEY` by default) answered by the official
 *    `GET /user/balance` envelope, and
 * 2. the signed-in DSH Platform account, answered through the harness's own
 *    `ctx.deepseekAccount` service so this plugin never touches that token.
 *
 * Nothing here logs a credential, and the endpoint is fixed to an HTTPS origin
 * supplied by configuration; redirects are refused so an authorization header
 * can never be forwarded to another host.
 * @module dsh-vk1-pet/host/balance
 */

import { retryAfterSeconds, sumCnyWallets } from './money.js';

/** Response bodies above this size are refused rather than buffered. */
const MAX_RESPONSE_BYTES = 1_048_576;

/** Credential reference read before the managed store, mirroring the app's DSHPET_KEY. */
export const OVERRIDE_ENV = 'DSHPET_KEY';

/** Reduction of a failure to something a human can act on. */
const MESSAGES = {
  unconfigured: '未找到 API Key 或 DSH 账号凭证，请在 DSH 的模型设置里配置',
  auth: '认证失败，请检查 API Key 或账号是否过期',
  'rate-limit': '请求过于频繁（429）',
  http: '服务返回异常状态',
  transport: '网络错误，请检查网络连接',
  parse: '响应无法解析',
};

/**
 * Build the failure envelope.
 * @param kind - machine-readable failure class.
 * @param detail - short human-readable reason appended to the class message.
 * @param extra - optional extra fields merged into the result.
 * @returns a failure result.
 */
function fail(kind, detail, extra = {}) {
  const base = MESSAGES[kind] ?? MESSAGES.transport;
  return { ok: false, kind, error: detail ? `${base}（${detail}）` : base, ...extra };
}

/**
 * Resolve the API-key credential through the DSH credential store, so the
 * lookup follows the same precedence the model adapters use (launch
 * environment, then `$DSH_HOME/.credentials.yaml`, then `.env` files).
 * @param ctx - host plugin context.
 * @param ref - credential reference name.
 * @returns the secret value, or null when it is not configured.
 */
async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials');
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref);
    if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) {
      return { value: hit.value, source: hit.source ?? ref };
    }
  }
  const ambient = process.env[ref];
  if (typeof ambient === 'string' && ambient.length > 0) return { value: ambient, source: ref };
  return null;
}

/**
 * Read the official API-key balance envelope.
 * @param options - endpoint origin, token, timeout, and display label.
 * @returns a normalised reading or a failure envelope.
 */
export async function fetchApiKeyBalance(options) {
  const { endpoint, token, timeoutMs, label } = options;
  let response;
  try {
    response = await fetch(`${endpoint}/user/balance`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'user-agent': 'DSH-VK1-Pet/1.0 (dsh-plugin)',
      },
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : '请求未完成';
    return fail('transport', reason);
  }

  if (response.status === 401 || response.status === 403) return fail('auth', `HTTP ${response.status}`);
  if (response.status === 429) {
    return fail('rate-limit', null, { retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')) });
  }
  if (response.status !== 200) return fail('http', `HTTP ${response.status}`);

  const text = await response.text().catch(() => null);
  if (text === null) return fail('transport', '响应读取失败');
  if (text.length > MAX_RESPONSE_BYTES) return fail('parse', '响应过大');

  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return fail('parse', '需要有效的 JSON 对象');
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return fail('parse', '需要有效的 JSON 对象');

  const total = sumCnyWallets(root.balance_infos, { required: true, amountKey: 'total_balance' });
  if (total.error !== undefined) return fail('parse', total.error);

  return {
    ok: true,
    fen: total.fen,
    spentFen: null,
    mode: 'api-key',
    source: 'API Key',
    detail: label,
  };
}

/**
 * Read the signed-in DSH Platform account balance through the harness service.
 * @param ctx - host plugin context.
 * @param meta - client identity metadata the provider requires.
 * @returns a normalised reading, `null` when signed out, or a failure envelope.
 */
async function fetchAccountBalance(ctx, meta) {
  const account = ctx.get('deepseekAccount');
  if (account === undefined) return null;

  let state;
  try {
    state = await account.getState();
  } catch (error) {
    return fail('transport', error?.message ?? '账号状态读取失败');
  }
  if (state?.status !== 'credential-stored') return null;

  let details;
  try {
    details = await account.getBalance(meta);
  } catch (error) {
    return fail('transport', error?.message ?? '账号余额读取失败');
  }
  if (details === null || details === undefined) return null;
  if (details.balance?.status !== 'ready') return fail('http', '账号余额查询失败');

  const normal = sumCnyWallets(details.balance.value, { required: true });
  if (normal.error !== undefined) return fail('parse', normal.error);
  const bonus = sumCnyWallets(details.balance.bonusWallets, { required: false });
  if (bonus.error !== undefined) return fail('parse', bonus.error);

  return {
    ok: true,
    fen: normal.fen + bonus.fen,
    spentFen: null,
    mode: 'account',
    source: 'DSH 账号',
    detail: 'deepseek-account-platform',
  };
}

/**
 * Read one balance reading for the configured source preference.
 * @param ctx - host plugin context.
 * @param config - resolved plugin configuration.
 * @returns a normalised reading; `kind: 'unconfigured'` when no credential exists.
 */
export async function readBalance(ctx, config) {
  const { source, apiKeyRef, endpoint, timeoutMs } = config;
  const meta = {
    version: config.version,
    locale: config.locale,
    timezoneOffsetSeconds: config.timezoneOffsetSeconds,
  };

  const tried = [];

  if (source !== 'account') {
    const override = process.env[OVERRIDE_ENV];
    let credential = null;
    let label = apiKeyRef;
    if (typeof override === 'string' && override.length > 0) {
      credential = { value: override, source: OVERRIDE_ENV };
      label = OVERRIDE_ENV;
    } else {
      credential = await resolveApiKey(ctx, apiKeyRef);
    }
    if (credential !== null) {
      const reading = await fetchApiKeyBalance({ endpoint, token: credential.value, timeoutMs, label });
      if (reading.ok) return reading;
      // A configured key that the server rejects is a real answer: report it
      // instead of silently falling through to a different credential.
      return reading;
    }
    tried.push('API Key');
  }

  if (source !== 'api-key') {
    const reading = await fetchAccountBalance(ctx, meta);
    if (reading !== null) return reading;
    tried.push('DSH 账号');
  }

  return fail('unconfigured', tried.length > 0 ? `已尝试：${tried.join('、')}` : null);
}
