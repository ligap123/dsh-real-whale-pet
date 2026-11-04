// DSH Host 侧余额读取：与 dsh-whale-widget 保持同一条链路与口径。
// ① DSH 凭据里的 DEEPSEEK_API_KEY → 官方 /user/balance（API key 永远优先）
// ② DSH 账号登录态 → ctx.deepseekAccount.getBalance(client)，不需要 API key
// 两条路互不干扰；都失败时把两边的失败原因一起返回，避免用户分不清"没登录"和"接口失败"。
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const ACCOUNT_TIMEOUT_MS = 12000;
const API_KEY_TIMEOUT_MS = 6000;

const toNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const isCurrency = value => value === 'CNY' || value === 'USD';
const numText = value => {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 30) return null;
  return Number(value);
};

// 与 whale-widget 的 pickBalanceInfo 同款优先级：
// 有余额的 CNY → 任何有余额 → CNY → 第一条。深户通常只有一个币种，这里保证多币种时口径稳定。
export function pickBalanceInfo(infos) {
  const list = Array.isArray(infos) ? infos.filter(row => row && isCurrency(row.currency) && numText(row.total_balance) !== null) : [];
  return list.find(row => row.currency === 'CNY' && toNumber(row.total_balance) > 0)
    || list.find(row => toNumber(row.total_balance) > 0)
    || list.find(row => row.currency === 'CNY')
    || list[0]
    || null;
}

function summary({ available = null, currency, total, granted = null, toppedUp = null, source }) {
  const money = value => (value === null || value === undefined || value === '' ? null : Number(value).toFixed(2));
  return {
    available: typeof available === 'boolean' ? available : null,
    source, currency, total: money(total),
    granted: money(granted),
    toppedUp: money(toppedUp),
    rows: [{ currency, total: money(total), granted: money(granted), toppedUp: money(toppedUp) }],
    updatedAt: Date.now()
  };
}

// ① DSH 凭据里的 API key：GET 官方 /user/balance（与 whale-widget 相同的 URL、Bearer 头与解析）。
async function apiKeyBalance(request, credential) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await request(BALANCE_URL, {
        headers: { Authorization: `Bearer ${credential}` },
        signal: AbortSignal.timeout(API_KEY_TIMEOUT_MS),
        redirect: 'error'
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) {
      lastError = new Error(response.status === 401 ? '密钥无效，请重新配置' : `余额接口返回 ${response.status}`);
      continue;
    }
    const body = await response.json().catch(() => { throw new Error('余额接口返回不是合法 JSON'); });
    if (!Array.isArray(body.balance_infos) || !body.balance_infos.length || body.balance_infos.length > 10) {
      throw new Error('余额接口返回结构异常');
    }
    const info = pickBalanceInfo(body.balance_infos);
    if (!info) throw new Error('余额接口返回结构异常');
    return summary({
      available: Boolean(body.is_available),
      currency: info.currency,
      total: info.total_balance,
      granted: numText(info.granted_balance) === null ? null : info.granted_balance,
      toppedUp: numText(info.topped_up_balance) === null ? null : info.topped_up_balance,
      source: 'apikey'
    });
  }
  throw new Error(`API key 路：${String((lastError && lastError.message) || lastError)}`);
}

function accountClient() {
  return {
    version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
    locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
  };
}

// ② DSH 账号登录态：钱包拆成充值钱包（value）与赠金钱包（bonusWallets），
// 两个钱包一起看；只登录客户端、只有赠金也算成功（与 DSH 自己的账号卡片口径一致）。
async function accountBalance(account) {
  let timer;
  let result;
  try {
    result = await Promise.race([
      account.getBalance(accountClient()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('账号余额请求超时')), ACCOUNT_TIMEOUT_MS); })
    ]);
  } finally { clearTimeout(timer); }
  if (!result) throw new Error('未登录 DeepSeek 账号（没有账号凭据）');
  if (result.status !== 'ready') throw new Error(`账号余额接口未就绪（${String(result.status || 'unknown')}）`);
  const normalize = list => (Array.isArray(list) ? list.filter(wallet => wallet && toNumber(wallet.balance) !== null) : []);
  const rechargeWallets = normalize(result.value);
  const bonusWallets = normalize(result.bonusWallets);
  const allWallets = rechargeWallets.concat(bonusWallets);
  if (!allWallets.length) throw new Error(result.value?.length || result.bonusWallets?.length ? '账号钱包字段不可用' : '账号没有余额钱包');
  const currencyOf = wallet => String((wallet && wallet.currency) || 'CNY').toUpperCase();
  const nonZero = allWallets.filter(wallet => Number(wallet.balance) > 0);
  const picked = nonZero.find(wallet => currencyOf(wallet) === 'CNY') || nonZero[0]
    || allWallets.find(wallet => currencyOf(wallet) === 'CNY') || allWallets[0];
  const currency = currencyOf(picked);
  const sumOf = list => list.filter(wallet => currencyOf(wallet) === currency).reduce((sum, wallet) => sum + Number(wallet.balance), 0);
  const recharge = sumOf(rechargeWallets);
  const bonus = sumOf(bonusWallets);
  return summary({
    currency,
    total: (recharge + bonus).toFixed(6),
    granted: bonus.toFixed(6),
    toppedUp: recharge.toFixed(6),
    source: 'account'
  });
}

// 可选服务一律用 ctx.get() 读取，绝不写进 inject：老宿主没有账号服务时不能因此完全不 apply。
export function createBalanceProvider(ctx, log = console, request = fetch) {
  return async function readBalance() {
    const reasons = [];
    let credentials = null;
    try { credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null; }
    catch (error) { reasons.push(`凭据服务不可用：${error.message}`); }
    if (credentials && typeof credentials.resolve === 'function') {
      try {
        const credential = await credentials.resolve('DEEPSEEK_API_KEY');
        if (credential && credential.value) {
          try { return await apiKeyBalance(request, credential.value); }
          catch (error) { reasons.push(error.message); }
        } else reasons.push('未配置 DEEPSEEK_API_KEY');
      } catch (error) { reasons.push(`凭据读取失败：${String(error.message || error).slice(0, 160)}`); }
    }
    let account = null;
    try { account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null; }
    catch (error) { reasons.push(`账号服务不可用：${error.message}`); }
    if (account && typeof account.getBalance === 'function') {
      try { return await accountBalance(account); }
      catch (error) { reasons.push(String(error.message || error).slice(0, 160)); }
    } else reasons.push('当前 DSH 没有账号服务');
    const message = `余额读取失败：${reasons.join('；')}`;
    log.warn?.(`[鲸鱼桌宠] ${message}`);
    throw new Error(message);
  };
}
