import { ensureElectron } from '../lib/electron-path.js';
try { console.log(await ensureElectron()); }
catch (error) { console.error(`Electron 准备失败：${error.message}`); process.exitCode = 1; }
