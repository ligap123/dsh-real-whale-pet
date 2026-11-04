import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from '../lib/storage.js';
import config from '../helper/shared/config.js';
const errors = [];
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (['node_modules', '.git', '.runtime-test'].includes(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:c?js|mjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) errors.push(`${file}: ${result.stderr}`);
    }
  }
}
walk(packageRoot);
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
if (manifest.dsh?.client) errors.push('本项目不应声明 dsh.client');
if (manifest.name !== 'dsh-real-whale-pet') errors.push('包名不一致');
const icon = fs.readFileSync(path.join(packageRoot, 'assets/icon.png'));
if (icon.length >= 256*1024) errors.push('图标超过 256KiB');
if (icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') errors.push('图标不是有效 PNG');
if (manifest.icon !== 'assets/icon.png') errors.push('package.json 的 icon 应指向 assets/icon.png');
for (const key of ['./locale/*.json', './icon', '.']) if (!manifest.exports?.[key]) errors.push(`exports 缺少 ${key}`);
for (const lang of ['en', 'zh']) {
  const file = path.join(packageRoot, 'locale', `${lang}.json`);
  if (!fs.existsSync(file)) { errors.push(`缺少 locale/${lang}.json`); continue; }
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8')).meta;
    if (!meta?.title || !meta?.description) errors.push(`locale/${lang}.json 缺少 meta.title/description`);
  } catch (error) { errors.push(`locale/${lang}.json 不是有效 JSON：${error.message}`); }
}
if (!manifest.engines?.dsh) errors.push('engines.dsh 缺失');
if (!/^>=0\.2\.1-rc\.\d+ <0\.3\.0-0$/.test(manifest.engines.dsh)) errors.push('engines.dsh 应允许 0.2.1 预发布版本（如 >=0.2.1-rc.1 <0.3.0-0）');
if (manifest.os?.length && !manifest.os.includes('win32')) errors.push('本项目只验收 Windows，os 应包含 win32');
const shots = JSON.parse(fs.readFileSync(path.join(packageRoot, 'screenshots.json')));
if (!Array.isArray(shots) || shots.length < 1 || shots.length > 8) errors.push('screenshots.json 需要 1 到 8 个路径');
for (const shot of shots) {
  if (!shot || shot.startsWith('/') || shot.includes('..') || !fs.existsSync(path.join(packageRoot, shot))) errors.push(`截图路径无效：${shot}`);
}
config.parseConfig(fs.readFileSync(path.join(packageRoot, 'assets/config.default.jsonc'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(packageRoot, 'assets/lines.json')));
for (const [name, group] of Object.entries(lines.groups)) {
  if (group.lines.length < 15) errors.push(`台词分组 ${name} 少于十五条`);
  for (const text of group.lines) if ([...text].length > 42) errors.push(`台词过长：${text}`);
}
for (const file of fs.readdirSync(path.join(packageRoot, 'assets/sfx'))) {
  const bytes = fs.readFileSync(path.join(packageRoot, 'assets/sfx', file));
  if (bytes.toString('ascii',0,4) !== 'RIFF' || bytes.readUInt32LE(24) !== 44100 || bytes.readUInt16LE(34) !== 16) errors.push(`音效规格错误：${file}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('检查通过：全部 JavaScript 语法、DSH 清单、JSONC、台词、音效与图标。');
