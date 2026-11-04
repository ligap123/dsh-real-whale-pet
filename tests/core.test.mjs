import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot, seedData } from '../lib/storage.js';
const require = createRequire(import.meta.url);
const { defaults, parseConfig, normalize, editConfig } = require('../helper/shared/config.js');
const { layout, clampBounds, cornerBounds, alphaHit, projectedOrigin } = require('../helper/shared/geometry.js');
const { readAsset } = require('../helper/shared/assets.js');
const { LinePicker, loadLines } = require('../helper/shared/lines.js');
const { requestBalance, keyStore } = require('../helper/shared/balance.js');
import { createBalanceProvider, pickBalanceInfo } from '../lib/balance-host.js';
import { createBalanceBridge } from '../lib/balance-bridge.js';
const fixtureBase = path.join(packageRoot, '.runtime-test');
function fixture(t) {
  fs.mkdirSync(fixtureBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtureBase, 'unit-'));
  t.after(() => { assert.equal(path.dirname(root), fixtureBase); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('JSONC 支持注释、尾逗号与字符串中的双斜杠；错误报告行号', () => {
  assert.equal(parseConfig('{\n// 注释\n"url":"https://example.com",\n}').url, 'https://example.com');
  assert.throws(() => parseConfig('{\n"pet": ?\n}'), /第 2 行/);
  assert.throws(() => parseConfig('[]'), /对象/);
});
test('配置合并、边界限制与无效类型降级，关闭值被保留', () => {
  const warnings = [];
  const config = normalize({ pet: { size: 999, enabled: false }, audio: { masterVolume: -1 }, speech: null, fx: { mode: '未知' }, accessory: { style: 'both' } }, x => warnings.push(x));
  assert.equal(config.pet.size, 620); assert.equal(config.pet.enabled, false); assert.equal(config.audio.masterVolume, 0);
  assert.equal(config.fx.mode, 'cinematic'); assert.equal(config.speech.displayMs, 6000); assert.equal(config.accessory.style, 'both'); assert.equal(warnings.length, 4);
  assert.equal(normalize({ pet: { size: NaN } }).pet.size, 260);
});
test('默认音量克制，音量与静音可配置并受边界约束', () => {
  assert.equal(defaults.audio.masterVolume, 0.3);
  assert.equal(defaults.audio.enabled, true);
  assert.equal(normalize({ audio: { masterVolume: 0.15 } }).audio.masterVolume, 0.15);
  assert.equal(normalize({ audio: { masterVolume: 2 } }).audio.masterVolume, 1);
  assert.equal(normalize({ audio: { enabled: false } }).audio.enabled, false);
});
test('菜单写配置保留原注释、其它字段与用户文本', t => {
  const root = fixture(t), file = path.join(root, 'config.jsonc');
  fs.writeFileSync(file, '{\n // 用户注释\n "pet": { "size": 260 }, "custom": "保留"\n}');
  editConfig(file, ['pet', 'size'], 320);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('// 用户注释')); assert.equal(parseConfig(text).custom, '保留'); assert.equal(parseConfig(text).pet.size, 320);
});
test('首次播种不覆盖用户配置与台词', t => {
  const root = fixture(t); seedData(root); fs.writeFileSync(path.join(root, 'lines.json'), '我的台词'); seedData(root);
  assert.equal(fs.readFileSync(path.join(root, 'lines.json'), 'utf8'), '我的台词'); assert.ok(fs.existsSync(path.join(root, 'config.jsonc')));
});
test('负坐标显示器、小屏幕与屏幕边缘的位置约束', () => {
  const area = { x: -1920, y: -100, width: 1920, height: 1080 }, dims = layout(260, area);
  const bounds = cornerBounds(dims, area, defaults.pet);
  assert.ok(bounds.x < 0); assert.ok(bounds.x+bounds.width <= 0); assert.ok(bounds.y+bounds.height <= 980);
  const small = layout(620, { width: 800, height: 600 }); assert.ok(small.width <= 800); assert.ok(small.height <= 600);
  assert.equal(clampBounds({ x: -5000, y: 9999, width: 400, height: 300 }, area).x, -1920);
  assert.deepEqual(projectedOrigin({ x: 100, y: 100 }, area), { x: 1920, y: 200 });
});
test('透明像素与白色实体使用 alpha 命中，而不是白色阈值', () => {
  const mask = { width: 2, height: 1, bytes: Buffer.from([255,255,255,0,255,255,255,255]) }, rect = { x: 0, y: 0, width: 20, height: 10 };
  assert.equal(alphaHit({ x: 2, y: 5 }, rect, mask), false); assert.equal(alphaHit({ x: 15, y: 5 }, rect, mask), true);
});
test('素材白名单拒绝路径穿越、绝对路径及目录联接逃逸', t => {
  const root = fixture(t), assets = path.join(root, 'assets'), outside = path.join(root, 'outside');
  fs.mkdirSync(assets); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'whale-hero.png'), '不可读');
  for (const name of ['../../README.md', 'C:\\Windows\\win.ini', '/etc/passwd', 'whale/../config.jsonc', 'fx/noise-tile.png/../../key']) assert.throws(() => readAsset(name, [assets]), /白名单/);
  fs.symlinkSync(outside, path.join(assets, 'whale'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readAsset('whale/whale-hero.png', [assets]), /实际路径/);
});
test('台词轮换二十分钟去重，耗尽时保持安静，并替换连击次数', () => {
  const picker = new LinePicker({ groups: { idle: { lines: ['一','二','三','四','五'] }, combo: { lines: ['{n} 次'] } } });
  const lines = Array.from({ length: 5 }, () => picker.pick('idle', 0, 100000, () => 0)?.text);
  assert.equal(new Set(lines).size, 5); assert.equal(picker.pick('idle', 0, 100001), null);
  assert.ok(picker.pick('idle', 0, 1300001)); assert.equal(picker.pick('combo', 8).text, '8 次');
});
test('台词损坏与缺字段回落默认，HTML 只作为普通文本保留', t => {
  const root = fixture(t), file = path.join(root, 'lines.json'), defaults = { version: 1, groups: { idle: { lines: ['默认'] } } };
  fs.writeFileSync(file, '{坏掉'); assert.deepEqual(loadLines(file, defaults), defaults);
  fs.writeFileSync(file, JSON.stringify({ groups: { idle: { lines: ['<img src=x onerror=alert(1)>'] } } }));
  assert.equal(loadLines(file, defaults).groups.idle.lines[0], '<img src=x onerror=alert(1)>');
});
test('余额只请求官方固定地址，返回充值、赠送及余额，不泄露密钥', async () => {
  let target, options;
  const result = await requestBalance('sk-test123456', async (url, init) => {
    target = url; options = init;
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] }) };
  });
  assert.equal(target, 'https://api.deepseek.com/user/balance'); assert.equal(options.redirect, 'error');
  assert.equal(result.rows[0].total, '110.00'); assert.equal(result.rows[0].granted, '10.00'); assert.equal(result.rows[0].toppedUp, '100.00');
  assert.equal(result.source, 'apikey'); assert.ok(!JSON.stringify(result).includes('sk-'));
});
test('多币种余额按 whale-widget 优先级只取一条：有余额的 CNY 优先', () => {
  const picked = pickBalanceInfo([
    { currency: 'USD', total_balance: '5.00' }, { currency: 'CNY', total_balance: '0.00' }, { currency: 'CNY', total_balance: '12.50' }
  ]);
  assert.equal(picked.currency, 'CNY'); assert.equal(picked.total_balance, '12.50');
  assert.equal(pickBalanceInfo([{ currency: 'USD', total_balance: '3.00' }, { currency: 'CNY', total_balance: '0.00' }]).currency, 'USD');
});
test('余额网络错误、无效密钥和服务错误有明确中文提示', async () => {
  await assert.rejects(requestBalance('bad'), /有效/);
  await assert.rejects(requestBalance('sk-test123456', async () => { throw new Error('秘密'); }), /网络/);
  await assert.rejects(requestBalance('sk-test123456', async () => ({ ok: false, status: 401 })), /密钥无效/);
  await assert.rejects(requestBalance('sk-test123456', async () => ({ ok: true, json: async () => ({ balance_infos: [] }) })), /无法识别/);
});
test('留空 Key 时经 DSH Host 桥接读余额（账号登录态），失败原因透传', async () => {
  const previous = { url: process.env.DSH_WHALE_BALANCE_URL, token: process.env.DSH_WHALE_BALANCE_TOKEN };
  process.env.DSH_WHALE_BALANCE_URL = 'http://127.0.0.1:45678/balance';
  process.env.DSH_WHALE_BALANCE_TOKEN = 'bridge-token';
  try {
    let seen;
    const result = await requestBalance(undefined, async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ ok: true, data: { source: 'account', available: null, updatedAt: 123, rows: [{ currency: 'CNY', total: '66.60', granted: '6.60', toppedUp: '60.00' }] } }) };
    });
    assert.equal(seen.url, 'http://127.0.0.1:45678/balance'); assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer bridge-token');
    assert.equal(result.source, 'account'); assert.equal(result.rows[0].total, '66.60'); assert.equal(result.available, null);
    await assert.rejects(requestBalance(undefined, async () => ({ ok: true, json: async () => ({ ok: false, error: '账号未登录 DeepSeek' }) })), /账号未登录/);
    delete process.env.DSH_WHALE_BALANCE_URL;
    await assert.rejects(requestBalance(undefined, async () => ({ ok: true, json: async () => ({}) })), /未配置 DSH 账号余额桥接/);
  } finally {
    if (previous.url === undefined) delete process.env.DSH_WHALE_BALANCE_URL; else process.env.DSH_WHALE_BALANCE_URL = previous.url;
    if (previous.token === undefined) delete process.env.DSH_WHALE_BALANCE_TOKEN; else process.env.DSH_WHALE_BALANCE_TOKEN = previous.token;
  }
});
test('Host 余额链路与 whale-widget 一致：DSH 凭据里的 key 优先', async () => {
  const resolved = [];
  const ctx = { get: name => name === 'credentials' ? { resolve: async ref => { resolved.push(ref); return { value: 'sk-dsh-key-123' }; } } : undefined };
  let target, options;
  const provider = createBalanceProvider(ctx, { warn() {} }, async (url, init) => {
    target = url; options = init;
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.00', granted_balance: '8.00', topped_up_balance: '80.00' }] }) };
  });
  const result = await provider();
  assert.deepEqual(resolved, ['DEEPSEEK_API_KEY']);
  assert.equal(target, 'https://api.deepseek.com/user/balance');
  assert.equal(options.headers.Authorization, 'Bearer sk-dsh-key-123');
  assert.equal(result.source, 'apikey'); assert.equal(result.total, '88.00'); assert.equal(result.currency, 'CNY');
});
test('Host 余额链路：没有 key 时用 DSH 账号登录态，充值+赠金合计', async () => {
  let meta;
  const ctx = { get: name => {
    if (name === 'credentials') return { resolve: async () => null };
    if (name === 'deepseekAccount') return { getBalance: async client => {
      meta = client;
      return { status: 'ready', value: [{ currency: 'CNY', balance: '100.00' }], bonusWallets: [{ currency: 'CNY', balance: '10.00' }] };
    } };
    return undefined;
  } };
  const result = await createBalanceProvider(ctx, { warn() {} })();
  assert.equal(typeof meta.timezoneOffsetSeconds, 'number'); assert.ok(meta.locale.length > 0);
  assert.equal(result.source, 'account'); assert.equal(result.currency, 'CNY');
  assert.equal(result.total, '110.00'); assert.equal(result.rows[0].toppedUp, '100.00'); assert.equal(result.rows[0].granted, '10.00');
});
test('Host 余额链路：key 路失败回退账号路，两边都失败才报错', async () => {
  const account = { getBalance: async () => ({ status: 'ready', value: [], bonusWallets: [{ currency: 'CNY', balance: '5.00' }] }) };
  const ctx = { get: name => name === 'credentials' ? { resolve: async () => ({ value: 'sk-expired-123' }) } : name === 'deepseekAccount' ? account : undefined };
  const result = await createBalanceProvider(ctx, { warn() {} }, async () => ({ ok: false, status: 401 }))();
  assert.equal(result.source, 'account'); assert.equal(result.total, '5.00');
  const signedOut = { get: name => name === 'credentials' ? { resolve: async () => null } : name === 'deepseekAccount' ? { getBalance: async () => null } : undefined };
  await assert.rejects(createBalanceProvider(signedOut, { warn() {} })(), /余额读取失败/);
});
test('Host 余额桥接只接受回环 + token，并透传结果与失败原因', async () => {
  const bridge = createBalanceBridge(async () => ({ source: 'account', rows: [{ currency: 'CNY', total: '1.00' }] }), { warn() {} });
  const info = await bridge.ready;
  try {
    assert.ok(info && info.url.startsWith('http://127.0.0.1:'));
    const ok = await fetch(info.url, { method: 'POST', headers: { Authorization: `Bearer ${info.token}` } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true); assert.equal(body.data.source, 'account');
    const denied = await fetch(info.url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } });
    assert.equal(denied.status, 403);
  } finally { bridge.close(); }
  const failing = createBalanceBridge(async () => { throw new Error('账号未登录'); }, { warn() {} });
  const failedInfo = await failing.ready;
  try {
    const body = await (await fetch(failedInfo.url, { method: 'POST', headers: { Authorization: `Bearer ${failedInfo.token}` } })).json();
    assert.equal(body.ok, false); assert.equal(body.error, '账号未登录');
  } finally { failing.close(); }
});
test('密钥仅通过系统加密保存，可删除；拒绝不安全的明文后端', t => {
  const root = fixture(t);
  const secure = { isEncryptionAvailable: () => true, encryptString: key => Buffer.from(key.split('').reverse().join('')), decryptString: bytes => bytes.toString().split('').reverse().join('') };
  const vault = keyStore(root, secure); vault.save('sk-test123456'); assert.equal(vault.read(), 'sk-test123456');
  assert.ok(!fs.readFileSync(path.join(root, 'deepseek-key.enc'), 'utf8').includes('sk-')); vault.remove(); assert.equal(vault.has(), false);
  assert.throws(() => keyStore(root, { ...secure, getSelectedStorageBackend: () => 'basic_text' }).save('sk-test123456'), /安全/);
});
