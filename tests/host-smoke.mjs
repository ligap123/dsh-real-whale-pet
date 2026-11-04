import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { packageRoot } from '../lib/storage.js';

// 子进程故意不调用清理函数，用于模拟宿主突然消失。
if (process.argv.includes('--child')) {
  const { apply } = await import('../index.js');
  apply({ effect: setup => { setup(); } });
} else {
  const base = path.join(packageRoot, '.runtime-test'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'host-'));
  fs.writeFileSync(path.join(root, 'config.jsonc'), '{"pet":{"introEffect":false},"audio":{"enabled":false}}');
  const host = spawn(process.execPath, [import.meta.filename, '--child'], { env: { ...process.env, DSH_WHALE_USER_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '';
  host.stdout.on('data', data => { text += data; }); host.stderr.on('data', data => { text += data; });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const start = Date.now();
    while (!text.includes('已就绪') && Date.now()-start < 15000) await sleep(100);
    assert.ok(text.includes('已就绪'), `宿主没有成功启动 Helper：${text}`);
    const query = process.platform === 'win32' ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${host.pid}" | Select-Object -ExpandProperty ProcessId`], { encoding: 'utf8', windowsHide: true }) : null;
    const childPid = query ? Number(query.stdout.trim().split(/\s+/)[0]) : null;
    if (process.platform === 'win32') assert.ok(Number.isSafeInteger(childPid) && childPid > 0, '未找到 Helper 子进程');
    host.kill();
    const killedAt = Date.now(); let alive = true;
    while (alive && Date.now()-killedAt < 3000) {
      try { if (childPid) process.kill(childPid, 0); else alive = false; }
      catch { alive = false; }
      await sleep(50);
    }
    assert.equal(alive, false, '宿主退出后三秒内 Helper 未停止');
    console.log(`Host 验证通过：Cordis apply 启动 Helper，父进程退出后 ${Date.now()-killedAt}ms 内子进程退出。`);
    const { startHelper } = await import('../lib/helper-process.js');
    const previousRoot = process.env.DSH_WHALE_USER_ROOT;
    process.env.DSH_WHALE_USER_ROOT = root;
    let log = '';
    const stop = startHelper({}, { info: (...args) => { log += args.join(' '); }, warn: (...args) => { log += args.join(' '); } });
    try {
      const started = Date.now();
      while (!log.includes('已就绪') && Date.now()-started < 15000) await sleep(100);
      assert.ok(log.includes('已就绪'), `正常生命周期启动失败：${log}`);
      const stopAt = Date.now(); await stop();
      assert.ok(Date.now()-stopAt < 3000, '插件清理超过三秒');
      console.log('Host 验证通过：插件清理函数停止 Helper，未触发守护重启。');
    } finally {
      await stop();
      if (previousRoot === undefined) delete process.env.DSH_WHALE_USER_ROOT; else process.env.DSH_WHALE_USER_ROOT = previousRoot;
    }
  } finally {
    host.kill(); await sleep(300);
    if (path.dirname(root) === base) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
