const fs = require('node:fs');
const path = require('node:path');
const jsonc = require('jsonc-parser');

const defaults = jsonc.parse(fs.readFileSync(path.join(__dirname, '../../assets/config.default.jsonc'), 'utf8'));

function parseConfig(text) {
  const errors = [];
  const value = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const line = text.slice(0, errors[0].offset).split('\n').length;
    const messages = { InvalidSymbol: '包含无法识别的字符', InvalidNumberFormat: '数字格式无效', PropertyNameExpected: '缺少字段名', ValueExpected: '缺少配置值', ColonExpected: '字段名后缺少冒号', CommaExpected: '字段之间缺少逗号', CloseBraceExpected: '缺少右花括号', CloseBracketExpected: '缺少右方括号', EndOfFileExpected: '配置对象后有多余内容', InvalidCommentToken: '注释格式无效', UnexpectedEndOfComment: '注释未结束', UnexpectedEndOfString: '字符串未结束', InvalidEscapeCharacter: '字符串转义无效' };
    throw new Error(`配置第 ${line} 行有误：${messages[jsonc.printParseErrorCode(errors[0].error)] || '格式无效'}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是一个对象');
  return value;
}

function normalize(input = {}, warn = () => {}) {
  const result = structuredClone(defaults);
  const ranges = {
    'pet.size': [180, 620], 'pet.marginX': [0, 500], 'pet.marginY': [0, 500],
    'fx.rippleDurationMs': [500, 5000], 'audio.masterVolume': [0, 1],
    'audio.idleMinSec': [5, 3600], 'audio.idleMaxSec': [5, 7200],
    'speech.idleMinSec': [10, 3600], 'speech.idleMaxSec': [10, 7200],
    'speech.clickChance': [0, 1], 'speech.rippleChance': [0, 1],
    'speech.displayMs': [1000, 20000], 'speech.maxChain': [1, 3],
    'advanced.holdToMuteMinutes': [1, 180]
  };
  const choices = {
    'pet.corner': ['bottom-right', 'bottom-left', 'top-right', 'top-left'],
    'fx.mode': ['cinematic', 'standard', 'minimal', 'off'],
    'fx.multiDisplay': ['all', 'origin', 'primary'], 'advanced.logLevel': ['info', 'warn', 'debug'],
    'accessory.style': ['off', 'male', 'female', 'both']
  };
  for (const [group, fields] of Object.entries(defaults)) {
    if (!fields || typeof fields !== 'object') continue;
    if (input[group] !== undefined && (!input[group] || typeof input[group] !== 'object' || Array.isArray(input[group]))) {
      warn(`配置字段 ${group} 必须是对象，已用默认值`); continue;
    }
    for (const [key, fallback] of Object.entries(fields)) {
      const value = input[group]?.[key];
      if (value === undefined) continue;
      const name = `${group}.${key}`;
      if (typeof value !== typeof fallback || (typeof value === 'number' && !Number.isFinite(value)) || (choices[name] && !choices[name].includes(value))) {
        warn(`配置字段 ${name} 无效，已用默认值`); continue;
      }
      result[group][key] = ranges[name] ? Math.min(ranges[name][1], Math.max(ranges[name][0], value)) : value;
      if (result[group][key] !== value) warn(`配置字段 ${name} 超出范围，已限制为 ${result[group][key]}`);
    }
  }
  for (const group of ['audio', 'speech']) result[group].idleMaxSec = Math.max(result[group].idleMinSec, result[group].idleMaxSec);
  return result;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, text, 'utf8'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function editConfig(file, keys, value) {
  const text = fs.readFileSync(file, 'utf8');
  parseConfig(text);
  atomicWrite(file, jsonc.applyEdits(text, jsonc.modify(text, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })));
}

module.exports = { defaults, parseConfig, normalize, atomicWrite, editConfig };
