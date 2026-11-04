import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { paths } from './storage.js';

const require = createRequire(import.meta.url);
const relativeExe = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';

export async function ensureElectron(explicit) {
  const { dshHome } = paths();
  let npmElectron;
  try { npmElectron = require('electron'); } catch { /* Electron 包可选，优先复用共享运行时。 */ }
  for (const candidate of [explicit, process.env.DSH_WHALE_ELECTRON_PATH, process.env.DSH_PET_ELECTRON_PATH, npmElectron, path.join(dshHome, 'electron', relativeExe)]) {
    if (typeof candidate === 'string' && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  const target = path.join(dshHome, 'electron');
  const staging = path.join(dshHome, `electron-whale-${process.pid}.tmp`);
  const { downloadArtifact } = await import('@electron/get');
  const { default: extract } = await import('@electron-internal/extract-zip');
  let timer;
  try {
    const zip = await Promise.race([
      downloadArtifact({ version: process.env.DSH_WHALE_ELECTRON_VERSION || '43.3.0', artifactName: 'electron',
        mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' }, downloadOptions: { quiet: true } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('下载 Electron 超过十分钟，请检查网络后重启 DSH')), 600000); })
    ]);
    fs.mkdirSync(staging, { recursive: true });
    await extract(zip, { dir: staging });
    if (!fs.existsSync(path.join(staging, relativeExe))) throw new Error('下载的 Electron 缺少可执行文件');
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(staging, target, { recursive: true, force: false });
    return path.join(target, relativeExe);
  } finally {
    clearTimeout(timer);
    if (path.dirname(path.resolve(staging)) === path.resolve(dshHome)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
