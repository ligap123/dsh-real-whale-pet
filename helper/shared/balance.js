const fs = require('node:fs');
const path = require('node:path');

const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const KEY_PATTERN = /^sk-[\w-]{8,200}$/;
const numText = value => (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && value.length <= 30 ? value : null);

// 与 lib/balance-host.js、dsh-whale-widget 同一优先级：有余额的 CNY → 任何有余额 → CNY → 第一条。
function pickBalanceInfo(infos) {
  const list = Array.isArray(infos) ? infos.filter(row => row && ['CNY', 'USD'].includes(row.currency) && numText(row.total_balance) !== null) : [];
  const num = row => Number(row.total_balance);
  return list.find(row => row.currency === 'CNY' && num(row) > 0)
    || list.find(row => num(row) > 0)
    || list.find(row => row.currency === 'CNY')
    || list[0]
    || null;
}

function normalizeSummary(data) {
  if (!data || !Array.isArray(data.rows) || !data.rows.length) throw new Error('余额服务返回了无法识别的数据');
  const row = data.rows[0];
  if (!row || !['CNY', 'USD'].includes(row.currency)) throw new Error('余额货币类型不受支持');
  for (const key of ['total', 'granted', 'toppedUp']) {
    if (row[key] !== null && row[key] !== undefined && numText(row[key]) === null) throw new Error('余额数值无效');
  }
  return {
    available: typeof data.available === 'boolean' ? data.available : null,
    rows: [{ currency: row.currency, total: String(row.total), granted: row.granted == null ? null : String(row.granted), toppedUp: row.toppedUp == null ? null : String(row.toppedUp) }],
    source: data.source === 'account' ? 'account' : 'apikey',
    updatedAt: Number(data.updatedAt) || Date.now()
  };
}

// API key 直连官方接口（面板里手动填入 Key 时使用；优先于 DSH 桥接）。
async function apiKeyBalance(key, request) {
  let response;
  try {
    response = await request(BALANCE_URL, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000), redirect: 'error'
    });
  } catch { throw new Error('余额查询失败：网络不可用或请求超时'); }
  if (!response.ok) throw new Error(response.status === 401 ? '密钥无效，请重新填写' : `余额查询失败，服务返回 ${response.status}`);
  const body = await response.json().catch(() => { throw new Error('余额服务返回了无效 JSON'); });
  if (!Array.isArray(body.balance_infos) || !body.balance_infos.length || body.balance_infos.length > 10) throw new Error('余额服务返回了无法识别的数据');
  const info = pickBalanceInfo(body.balance_infos);
  if (!info) throw new Error('余额服务返回了无法识别的数据');
  return normalizeSummary({
    available: Boolean(body.is_available),
    rows: [{ currency: info.currency, total: info.total_balance, granted: numText(info.granted_balance) === null ? null : info.granted_balance, toppedUp: numText(info.topped_up_balance) === null ? null : info.topped_up_balance }],
    source: 'apikey',
    updatedAt: Date.now()
  });
}

// DSH Host 桥接：账号登录态 / DSH 凭据里的 key 由 Host 进程读取，Helper 只拿结果。
async function bridgeBalance(request) {
  const url = process.env.DSH_WHALE_BALANCE_URL || '';
  if (!url) throw new Error('未配置 DSH 账号余额桥接，请填写 API Key');
  let response;
  try {
    response = await request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.DSH_WHALE_BALANCE_TOKEN || ''}` },
      signal: AbortSignal.timeout(30000)
    });
  } catch { throw new Error('余额查询失败：DSH 宿主没有响应'); }
  const body = await response.json().catch(() => { throw new Error('余额服务返回了无效 JSON'); });
  if (!response.ok || !body || body.ok !== true) throw new Error(String((body && body.error) || '余额查询失败，请稍后重试').slice(0, 300));
  return normalizeSummary(body.data);
}

async function requestBalance(key, request = fetch) {
  if (typeof key === 'string' && key.trim()) {
    if (!KEY_PATTERN.test(key.trim())) throw new Error('请输入有效的 DeepSeek API Key');
    return apiKeyBalance(key.trim(), request);
  }
  return bridgeBalance(request);
}

function keyStore(root, encryption) {
  const file = path.join(root, 'deepseek-key.enc');
  return {
    has: () => fs.existsSync(file),
    read() {
      if (!fs.existsSync(file)) return null;
      if (!encryption.isEncryptionAvailable()) throw new Error('本机加密服务暂不可用');
      try { return encryption.decryptString(fs.readFileSync(file)); }
      catch { throw new Error('无法解密本机密钥，请重新填写'); }
    },
    save(key) {
      if (!encryption.isEncryptionAvailable() || encryption.getSelectedStorageBackend?.() === 'basic_text') throw new Error('本机未提供安全的密钥加密服务，无法保存');
      if (!KEY_PATTERN.test(key)) throw new Error('密钥格式无效');
      const temp = `${file}.tmp`;
      try { fs.writeFileSync(temp, encryption.encryptString(key), { mode: 0o600 }); fs.renameSync(temp, file); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    },
    remove() { fs.rmSync(file, { force: true }); }
  };
}
module.exports = { requestBalance, keyStore, pickBalanceInfo };
