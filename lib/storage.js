import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export function paths(env = process.env) {
  const dshHome = path.resolve(env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  return { dshHome, userRoot: path.resolve(env.DSH_WHALE_USER_ROOT || path.join(dshHome, 'dsh-real-whale-pet')), packageRoot };
}
export function seedData(userRoot) {
  for (const name of ['logs', 'cache', 'sfx', 'fx', 'whale']) fs.mkdirSync(path.join(userRoot, name), { recursive: true });
  for (const [source, target] of [['config.default.jsonc', 'config.jsonc'], ['lines.json', 'lines.json']]) {
    try { fs.copyFileSync(path.join(packageRoot, 'assets', source), path.join(userRoot, target), fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
