const fs = require('node:fs');
const path = require('node:path');

const allowed = /^(?:whale\/whale-hero\.png|fx\/(?:caustics-tile|water-normal|foam-ring|splash-crown|droplets-tile|bubbles-atlas|noise-tile)\.png|sfx\/(?:click_boing|splash_big|combo_[1-7]|moan_idle_[1-5]|deep_song|drag_squeak|drop_plop|bubble_blip|rare_airhorn|ambient_underwater)\.wav)$/;
function readAsset(relative, roots) {
  if (typeof relative !== 'string' || !allowed.test(relative)) throw new Error('素材路径不在白名单内');
  for (const root of roots) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const base = fs.realpathSync(root);
    const real = fs.realpathSync(file);
    const child = path.relative(base, real);
    if (child.startsWith('..') || path.isAbsolute(child)) throw new Error('素材实际路径越出白名单目录');
    if (fs.statSync(real).size > 16 * 1024 * 1024) throw new Error('素材超过 16MB 限制');
    return fs.readFileSync(real);
  }
  return null;
}
module.exports = { readAsset };
