import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureElectron } from './electron-path.js';
import { createBalanceBridge } from './balance-bridge.js';
import { paths, seedData } from './storage.js';

export function startHelper(config = {}, log = console, options = {}) {
  const { dshHome, userRoot, packageRoot } = paths();
  seedData(userRoot);
  // 余额读不到时（离线/无账号），日志仍要能看出是 Host 桥接本身没起来。
  const bridge = options.balance ? createBalanceBridge(options.balance, log) : null;
  let bridgeInfo = null, child, timer, stopped = false, failures = 0;
  const logFile = path.join(userRoot, 'logs', 'helper.log');
  function output(data) {
    const text = data.toString().trim();
    if (!text) return;
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
        fs.rmSync(`${logFile}.1`, { force: true }); fs.renameSync(logFile, `${logFile}.1`);
      }
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
    } catch (error) { log.warn?.(`[鲸鱼桌宠] 日志写入失败：${error.code || '未知错误'}`); }
    log.info?.('[鲸鱼桌宠]', text);
  }
  async function launch() {
    try {
      const executable = await ensureElectron(config.electronPath);
      if (stopped) return;
      const env = { ...process.env, DSH_HOME: dshHome, DSH_WHALE_USER_ROOT: userRoot, DSH_WHALE_HOST_PID: String(process.pid) };
      // 只有监听成功的桥接才把地址交给 Helper；失败时 Helper 会退回"面板里填 API Key"。
      if (bridgeInfo) {
        env.DSH_WHALE_BALANCE_URL = bridgeInfo.url;
        env.DSH_WHALE_BALANCE_TOKEN = bridgeInfo.token;
      }
      delete env.ELECTRON_RUN_AS_NODE;
      const started = Date.now();
      child = spawn(executable, [path.join(packageRoot, 'helper')], { cwd: dshHome, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.stdin.on('error', () => { /* Helper 已退出时不让断管异常影响 DSH。 */ });
      child.once('error', error => output(`子进程启动失败：${error.message}`));
      child.once('exit', (code, signal) => {
        child = null;
        if (stopped || code === 0) return;
        if (Date.now() - started > 180000) failures = 0;
        retry(`桌宠退出：${code ?? signal}`);
      });
    } catch (error) { retry(error.message); }
  }
  function retry(reason) {
    output(reason);
    if (stopped || ++failures >= 8) { output('已停止自动重试，重启 DSH 后恢复'); return; }
    timer = setTimeout(launch, Math.min(30000, 1000 * 2 ** (failures - 1)));
  }
  // 先把桥接的监听结果拿到，再拉起 Helper，保证子进程启动时环境变量已经就绪。
  void (bridge ? bridge.ready.then(info => { bridgeInfo = info; }) : Promise.resolve()).then(() => launch());
  return async function stop() {
    stopped = true; clearTimeout(timer);
    try { bridge?.close(); } catch { /* 已关闭 */ }
    const active = child;
    if (!active) return;
    await new Promise(resolve => {
      const force = setTimeout(() => {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(active.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else active.kill('SIGKILL');
        resolve();
      }, 2000);
      active.once('exit', () => { clearTimeout(force); resolve(); });
      active.kill('SIGTERM');
    });
  };
}
