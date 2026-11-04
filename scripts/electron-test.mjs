import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ensureElectron } from '../lib/electron-path.js';
import { packageRoot } from '../lib/storage.js';
import { createBalanceBridge } from '../lib/balance-bridge.js';
const base = path.join(packageRoot, '.runtime-test');
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'electron-'));
const video = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(root, 'video.mp4')], { windowsHide: true, encoding: 'utf8' });
if (video.status !== 0) console.log('未检测到可用 ffmpeg，跳过本地全屏视频回归。');
// 用假的 Host 余额桥接模拟 DSH 账号登录态，验证 Helper ↔ Host 的取数链路（不联网、不需要真凭据）。
const bridge = createBalanceBridge(async () => ({
  available: null, source: 'account', currency: 'CNY', total: '88.88', granted: '8.88', toppedUp: '80.00',
  rows: [{ currency: 'CNY', total: '88.88', granted: '8.88', toppedUp: '80.00' }], updatedAt: Date.now()
}), console);
const bridgeInfo = await bridge.ready;
const executable = await ensureElectron();
const env = { ...process.env, DSH_WHALE_USER_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE; delete env.DSH_WHALE_HOST_PID;
if (bridgeInfo) { env.DSH_WHALE_BALANCE_URL = bridgeInfo.url; env.DSH_WHALE_BALANCE_TOKEN = bridgeInfo.token; }
const child = spawn(executable, [path.join(packageRoot, 'tests/electron-smoke.cjs')], { env, cwd: packageRoot, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { child.kill(); console.error('Electron 验证超时'); }, 60000);
child.once('exit', code => {
  clearTimeout(timeout);
  bridge.close();
  // 清理前确保路径只位于本次测试目录中。
  if (path.dirname(path.resolve(root)) === path.resolve(base)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exitCode = code ?? 1;
});
