const fs = require('node:fs');
function loadLines(file, fallback, warn = () => {}) {
  let input;
  try { input = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { warn('台词文件有误，已使用默认台词'); input = {}; }
  const result = structuredClone(fallback);
  for (const group of Object.keys(fallback.groups)) {
    const lines = input.groups?.[group]?.lines;
    if (Array.isArray(lines) && lines.length && lines.every(text => typeof text === 'string' && text.trim() && [...text].length <= 42)) {
      result.groups[group].lines = lines;
    } else if (Object.keys(input).length) warn(`台词分组 ${group} 缺失或无效，已用默认台词`);
  }
  return result;
}
class LinePicker {
  constructor(data, history = {}) { this.data = data; this.history = history; }
  pick(group, combo = 0, now = Date.now(), random = Math.random) {
    const lines = this.data.groups[group]?.lines || this.data.groups.idle.lines;
    let pool = lines.map((text, i) => ({ text, id: `${group}:${i}` }));
    if (lines.length >= 5) pool = pool.filter(item => !this.history[item.id] || now - this.history[item.id] > 1200000);
    // 所有台词都在冷却时保持安静，避免回退后重复刷屏。
    if (!pool.length) return null;
    const selected = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    this.history[selected.id] = now;
    return { id: selected.id, text: selected.text.replaceAll('{n}', String(combo)) };
  }
}
module.exports = { loadLines, LinePicker };
