const { app, BrowserWindow, ipcMain, screen, Menu, Tray, shell, nativeImage, desktopCapturer, powerMonitor, safeStorage, session, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { defaults, parseConfig, normalize, atomicWrite, editConfig } = require('./shared/config');
const { layout, clampBounds, cornerBounds, contains, projectedOrigin, alphaHit } = require('./shared/geometry');
const { readAsset } = require('./shared/assets');
const { loadLines, LinePicker } = require('./shared/lines');
const { requestBalance, keyStore } = require('./shared/balance');

const packageRoot = path.join(__dirname, '..');
const userRoot = process.env.DSH_WHALE_USER_ROOT || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-real-whale-pet');
for (const folder of ['', 'logs', 'cache', 'whale', 'sfx', 'fx']) fs.mkdirSync(path.join(userRoot, folder), { recursive: true });
for (const [source, destination] of [['config.default.jsonc', 'config.jsonc'], ['lines.json', 'lines.json']]) {
  const target = path.join(userRoot, destination);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(packageRoot, 'assets', source), target);
}
const configFile = path.join(userRoot, 'config.jsonc');
const stateFile = path.join(userRoot, 'state.json');
const assetRoots = [userRoot, path.join(packageRoot, 'assets')];
let pendingWarning = '', cfg = structuredClone(defaults), state = { version: 1, clickCount: 0, lineHistory: {} };
function warn(text) { pendingWarning = text; console.warn(`[鲸鱼桌宠] ${text}`); }
function readConfig() {
  try { cfg = normalize(parseConfig(fs.readFileSync(configFile, 'utf8')), warn); return true; }
  catch (error) { warn(`${error.message}，已保留上一份有效配置`); return false; }
}
readConfig();
try { Object.assign(state, JSON.parse(fs.readFileSync(stateFile, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') { fs.renameSync(stateFile, `${stateFile}.corrupt-${Date.now()}.bak`); warn('位置记录损坏，已恢复默认位置'); } }
if (!Number.isSafeInteger(state.clickCount) || state.clickCount < 0) state.clickCount = 0;
if (!state.lineHistory || typeof state.lineHistory !== 'object' || Array.isArray(state.lineHistory)) state.lineHistory = {};
const fallbackLines = JSON.parse(fs.readFileSync(path.join(packageRoot, 'assets/lines.json'), 'utf8'));
let picker = new LinePicker(loadLines(path.join(userRoot, 'lines.json'), fallbackLines, warn), state.lineHistory);

app.setName('写实座头鲸桌宠');
app.setPath('userData', path.join(userRoot, 'runtime'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (cfg.advanced.disableHardwareAcceleration) app.disableHardwareAcceleration();

let petWindow, panelWindow, tray, watcher, poll, deepTimer, soundTimer, speechTimer, reloadTimer;
let regions = {}, mask, drag = null, menuBusy = false, ignoreMouse = null, disposed = false;
let quietUntil = 0, bubbleDeadline = 0, chain = 0, clicks = [], lastInteraction = Date.now(), lastDeep = 0, lastRare = 0;
let aspect = 1672 / 941, petHeight = 260, rippleToken = 0, balanceBusy = false;
const overlays = new Map();
const vault = keyStore(userRoot, safeStorage);
const send = (channel, data) => { if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, data); };
const quiet = () => quietUntil > Date.now();
const active = () => cfg.pet.enabled && !quiet();
function saveState() {
  if (petWindow && !petWindow.isDestroyed()) state.position = petWindow.getBounds();
  state.lastSeenAt = Date.now();
  state.lineHistory = Object.fromEntries(Object.entries(picker.history).filter(([, time]) => Date.now() - time < 1200000));
  try { atomicWrite(stateFile, JSON.stringify(state, null, 2)); } catch (error) { warn(`无法保存状态：${error.message}`); }
}
function interaction() { lastInteraction = Date.now(); }
function sfx(id, extra = {}) { if (active() && cfg.audio.enabled) send('pet:sfx', { id, ...extra }); }
function say(group, combo = 0, force = false) {
  if (!active() || !cfg.speech.enabled || (!force && Date.now() < bubbleDeadline && chain >= cfg.speech.maxChain)) return;
  const line = picker.pick(group, combo);
  if (!line) return;
  if (Date.now() >= bubbleDeadline) chain = 0;
  chain++;
  bubbleDeadline = Date.now() + cfg.speech.displayMs;
  state.lastLineId = line.id;
  send('pet:speech', { text: line.text, ms: cfg.speech.displayMs });
  sfx('bubble_blip');
}
function reportWarning() {
  if (!pendingWarning) return;
  send('pet:speech', { text: pendingWarning, ms: 8000 }); pendingWarning = '';
}
function updateMask() {
  try {
    const bytes = readAsset('whale/whale-hero.png', assetRoots);
    if (!bytes) throw new Error('缺少鲸鱼图，请在数据目录 whale 中放入 whale-hero.png');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('鲸鱼图无法解码');
    const size = image.getSize(); aspect = size.width / size.height;
    const small = image.resize({ width: 256 });
    mask = { ...small.getSize(), bytes: small.toBitmap() };
  } catch (error) { mask = null; warn(error.message); }
}
function resizePet(reset = false) {
  const previous = petWindow.getBounds();
  const stored = state.position;
  const hasPosition = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y);
  const display = screen.getDisplayNearestPoint(hasPosition && !reset ? { x: stored.x+48, y: stored.y+150 } : { x: previous.x+48, y: previous.y+150 });
  const area = display.workArea;
  const dims = layout(cfg.pet.size, area, aspect); petHeight = dims.petHeight;
  const bounds = reset || !hasPosition ? cornerBounds(dims, area, cfg.pet) : clampBounds({ x: stored.x, y: stored.y, width: dims.width, height: dims.height }, area);
  petWindow.setBounds(bounds);
  petWindow.setAlwaysOnTop(cfg.pet.alwaysOnTop, 'screen-saver');
  if (cfg.pet.enabled) petWindow.showInactive(); else petWindow.hide();
  send('pet:config', { config: cfg, petHeight, quiet: quiet() });
}
// 宠物窗口的穿透状态只在这里写；水波窗口始终穿透。
function setPetInteractive(enabled) {
  const next = !enabled;
  if (ignoreMouse === next) return;
  ignoreMouse = next; petWindow.setIgnoreMouseEvents(next, { forward: true });
}
function cursorHit() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (quietUntil && quietUntil <= Date.now()) { quietUntil = 0; send('pet:config', { config: cfg, petHeight, quiet: false }); }
  const cursor = screen.getCursorScreenPoint(), bounds = petWindow.getBounds();
  const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  const accessoryHit = (Array.isArray(regions.accessory) ? regions.accessory : [regions.accessory]).some(region => contains(point, region));
  const hit = contains(point, regions.bubble) || accessoryHit || contains(point, regions.balance) || contains(point, regions.fallback) || alphaHit(point, regions.whale, mask);
  setPetInteractive(cfg.pet.enabled && Boolean(drag || menuBusy || hit));
  if (bubbleDeadline && Date.now() >= bubbleDeadline) { bubbleDeadline = 0; chain = 0; send('pet:speech-close'); }
}
function safeWindow(options) {
  const win = new BrowserWindow({ transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
    backgroundColor: '#00000000', show: false, ...options,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, ...options.webPreferences } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', (_, details) => { if (disposed) return; warn(`渲染进程退出：${details.reason}`); if (win === petWindow) app.exit(1); else win.destroy(); });
  return win;
}
function createOverlay(display) {
  if (overlays.has(display.id)) return overlays.get(display.id);
  const win = safeWindow({ ...display.bounds, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js') } });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  const entry = { win, id: display.id, timer: null, token: 0 };
  entry.ready = win.loadFile(path.join(__dirname, 'overlay/index.html'));
  entry.ready.catch(error => { if (!disposed && !win.isDestroyed()) warn(`水波窗口加载失败：${error.message}`); });
  win.on('closed', () => { clearTimeout(entry.timer); overlays.delete(display.id); });
  overlays.set(display.id, entry);
  return entry;
}
async function capture(displays) {
  const maxWidth = Math.max(...displays.map(d => Math.round(d.bounds.width * Math.min(d.scaleFactor, 1.5))));
  const maxHeight = Math.max(...displays.map(d => Math.round(d.bounds.height * Math.min(d.scaleFactor, 1.5))));
  let timer;
  try {
    return await Promise.race([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxWidth, height: maxHeight }, fetchWindowIcons: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('截图超时，已改用标准水波')), 400); })
    ]);
  } finally { clearTimeout(timer); }
}
function validShot(image) {
  if (!image || image.isEmpty()) return false;
  const sample = image.resize({ width: 16, height: 16 }).toBitmap();
  return sample.some((value, index) => index % 4 !== 3 && value > 10);
}
function finishOverlay(entry, token) {
  if (entry.token !== token || entry.win.isDestroyed()) return;
  clearTimeout(entry.timer); entry.win.webContents.send('ripple:clear'); entry.win.hide();
}
async function playRipple(point, combo = 1, slow = false) {
  if (!active() || cfg.fx.mode === 'off' || disposed) return;
  const token = ++rippleToken;
  const originDisplay = screen.getDisplayNearestPoint(point);
  let displays = screen.getAllDisplays();
  if (cfg.fx.multiDisplay === 'origin') displays = [originDisplay];
  if (cfg.fx.multiDisplay === 'primary') displays = [screen.getPrimaryDisplay()];
  const entries = displays.map(createOverlay);
  const wasVisible = entries.some(entry => entry.win.isVisible());
  let sources = [];
  if (cfg.fx.mode === 'cinematic' && cfg.fx.captureScreen && !wasVisible) {
    try { sources = await capture(displays); }
    catch (error) { console.warn(`[鲸鱼桌宠] ${error.message}`); }
  }
  await Promise.all(entries.map(entry => entry.ready));
  if (disposed || token !== rippleToken || !active() || cfg.fx.mode === 'off') return;
  const duration = Math.min(5000, cfg.fx.rippleDurationMs * (slow ? 1.5 : 1));
  entries.forEach((entry, index) => {
    if (entry.win.isDestroyed()) return;
    const display = displays[index];
    const source = sources.find(source => source.display_id === String(display.id));
    const shot = validShot(source?.thumbnail) ? source.thumbnail.toPNG() : null;
    const delay = display.id === originDisplay.id ? 0 : 90;
    entry.token = token; clearTimeout(entry.timer);
    entry.win.webContents.send('ripple:play', { token, origin: projectedOrigin(point, display.bounds),
      duration, delay, combo: Math.min(combo, 12), mode: cfg.fx.mode, shot, seed: Math.random() });
    entry.win.showInactive();
    entry.timer = setTimeout(() => finishOverlay(entry, token), duration + delay + 700);
  });
  sfx('splash_big');
}
function hideOverlays() {
  rippleToken++;
  for (const entry of overlays.values()) finishOverlay(entry, entry.token);
}
function handleClick(point) {
  interaction(); state.clickCount++;
  const now = Date.now(); clicks = clicks.filter(time => now - time < 1500).concat(now);
  const combo = clicks.length;
  if (combo > 1) sfx(`combo_${Math.min(combo - 1, 7)}`);
  if (cfg.audio.rareAirhorn && Math.random() < .02) sfx('rare_airhorn');
  send('pet:reaction', { type: 'click', combo });
  void playRipple(point, combo).catch(error => warn(`水波已降级：${error.message}`));
  if (combo >= 3) say('combo', combo);
  else if (bubbleDeadline > now || Math.random() < cfg.speech.clickChance) say('click', combo);
  else if (cfg.fx.mode !== 'off' && Math.random() < cfg.speech.rippleChance) say('ripple', combo);
}
function scheduleIdle() {
  clearTimeout(soundTimer); clearTimeout(speechTimer); clearInterval(deepTimer);
  if (!cfg.pet.enabled) return;
  const wait = group => (group.idleMinSec + Math.random() * (group.idleMaxSec - group.idleMinSec)) * 1000;
  function soundTick() {
    soundTimer = setTimeout(() => {
      if (Date.now() - lastInteraction > 8000 && cfg.audio.idleSounds) sfx(`moan_idle_${1 + Math.floor(Math.random() * 5)}`);
      soundTick();
    }, wait(cfg.audio));
  }
  function speechTick() {
    speechTimer = setTimeout(() => {
      if (Date.now() - lastInteraction > 20000 && !drag) {
        const hour = new Date().getHours();
        const rare = Date.now() - lastRare > 1800000 && Math.random() < .1;
        if (rare) lastRare = Date.now();
        say(rare ? 'rare' : (hour >= 23 || hour < 5) ? 'night' : 'idle');
      }
      speechTick();
    }, wait(cfg.speech));
  }
  soundTick(); speechTick();
  deepTimer = setInterval(() => {
    if (!active() || !cfg.audio.idleSounds || Date.now() - lastInteraction < 600000 || Date.now() - lastDeep < 1800000) return;
    lastDeep = Date.now(); sfx('deep_song'); say('rare');
    const b = petWindow.getBounds(); void playRipple({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, 1, true);
  }, 60000);
}
function reload() {
  const before = cfg;
  if (!readConfig()) { reportWarning(); return; }
  picker.data = loadLines(path.join(userRoot, 'lines.json'), fallbackLines, warn);
  updateMask();
  const reset = cfg.pet.corner !== before.pet.corner || cfg.pet.marginX !== before.pet.marginX || cfg.pet.marginY !== before.pet.marginY;
  resizePet(reset); hideOverlays();
  for (const entry of [...overlays.values()]) entry.win.destroy();
  if (cfg.fx.prewarmOverlay && cfg.fx.mode !== 'off') createOverlay(screen.getPrimaryDisplay());
  scheduleIdle();
  send('pet:reload');
  if (before.advanced.disableHardwareAcceleration !== cfg.advanced.disableHardwareAcceleration) warn('硬件加速选项将在重启桌宠后生效');
  reportWarning();
}
function setting(keys, value) {
  try {
    const text = fs.readFileSync(configFile, 'utf8');
    try { parseConfig(text); }
    catch {
      fs.copyFileSync(configFile, `${configFile}.corrupt-${Date.now()}.bak`);
      atomicWrite(configFile, JSON.stringify(cfg, null, 2));
      warn('损坏配置已备份，菜单设置将在上一份有效配置上继续保存');
    }
    editConfig(configFile, keys, value); reload(); return true;
  } catch (error) { warn(`无法修改配置：${error.message}`); reportWarning(); return false; }
}
function openPanel() {
  if (panelWindow && !panelWindow.isDestroyed()) { panelWindow.show(); panelWindow.focus(); return; }
  panelWindow = new BrowserWindow({ title: '鲸鱼 · 余额与挂件', width: 480, height: 800, useContentSize: true, resizable: false, backgroundColor: '#0a1724',
    autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  panelWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panelWindow.webContents.on('will-navigate', event => event.preventDefault());
  panelWindow.loadFile(path.join(__dirname, 'panel/index.html'));
  panelWindow.on('closed', () => { panelWindow = null; });
}
function menuItems() {
  return [
    { label: 'DeepSeek 余额与挂件…', click: openPanel },
    { label: '静音', type: 'checkbox', checked: !cfg.audio.enabled, click: item => setting(['audio', 'enabled'], !item.checked) },
    { label: quiet() ? '恢复声音与说话' : `安静 ${cfg.advanced.holdToMuteMinutes} 分钟`, click: () => {
      quietUntil = quiet() ? 0 : Date.now() + cfg.advanced.holdToMuteMinutes * 60000;
      send('pet:config', { config: cfg, petHeight, quiet: quiet() }); send('pet:speech-close');
    } },
    { label: '音量', submenu: [.05, .1, .2, .3, .5, .7, 1].map((value, index) => ({ label: ['5%', '10%', '20%', '30%', '50%', '70%', '100%'][index], type: 'radio', checked: Math.abs(cfg.audio.masterVolume - value) < 1e-9, click: () => setting(['audio', 'masterVolume'], value) })) },
    { label: '特效', submenu: ['cinematic', 'standard', 'minimal', 'off'].map((value, index) => ({ label: ['电影级', '标准', '极简', '关闭'][index], type: 'radio', checked: cfg.fx.mode === value, click: () => setting(['fx', 'mode'], value) })) },
    { label: '说话', type: 'checkbox', checked: cfg.speech.enabled, click: item => setting(['speech', 'enabled'], item.checked) },
    { label: '幽默挂件', submenu: ['off', 'male', 'female', 'both'].map((value, index) => ({ label: ['关闭', '男版  🥚🍆🥚', '女版  🌏🌏', '两种都喜欢'][index], type: 'radio', checked: cfg.accessory.style === value, click: () => setting(['accessory', 'style'], value) })) },
    { label: '大小', submenu: [220, 260, 320, 400].map(value => ({ label: String(value), type: 'radio', checked: cfg.pet.size === value, click: () => setting(['pet', 'size'], value) })) },
    { label: '置顶', type: 'checkbox', checked: cfg.pet.alwaysOnTop, click: item => setting(['pet', 'alwaysOnTop'], item.checked) },
    { label: cfg.pet.enabled ? '隐藏鲸鱼' : '显示鲸鱼', click: () => setting(['pet', 'enabled'], !cfg.pet.enabled) },
    { label: '回到右下角', click: () => { state.position = null; setting(['pet', 'corner'], 'bottom-right'); resizePet(true); saveState(); } },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(userRoot) },
    { label: '重载配置与素材', click: reload },
    { label: '关于与素材授权', click: () => dialog.showMessageBox({ type: 'info', title: '关于写实座头鲸', message: '写实座头鲸 1.0.0',
      detail: `代码：MIT。鲸鱼原图由用户提供，单次 AI 去背。水波、音效与台词为本项目生成。完整来源见项目 NOTICE。\n\n数据目录：${userRoot}`,
      buttons: ['知道了'] }) },
    { label: '退出桌宠', click: () => app.quit() }
  ];
}
function menu() {
  interaction(); menuBusy = true; cursorHit();
  Menu.buildFromTemplate(menuItems()).popup({ window: petWindow, callback: () => { menuBusy = false; cursorHit(); } });
}
function onPet(channel, callback) {
  ipcMain.on(channel, (event, payload) => { if (!disposed && petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents) callback(payload); });
}
function registerIPC() {
  ipcMain.handle('asset:read', (event, relative) => {
    if (disposed) return null;
    const allowedSender = !disposed && ((petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents) || [...overlays.values()].some(entry => !entry.win.isDestroyed() && event.sender === entry.win.webContents));
    if (!allowedSender) throw new Error('不允许读取素材');
    return readAsset(relative, assetRoots);
  });
  onPet('pet:regions', data => { if (data && typeof data === 'object') regions = data; });
  onPet('pet:context-menu', menu);
  onPet('pet:open-panel', openPanel);
  onPet('pet:speech-close', () => { bubbleDeadline = 0; chain = 0; });
  onPet('pet:drag-start', () => { interaction(); drag = { start: screen.getCursorScreenPoint(), bounds: petWindow.getBounds(), at: Date.now(), moved: false }; cursorHit(); });
  onPet('pet:drag-move', () => {
    if (!drag) return;
    const point = screen.getCursorScreenPoint();
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) petWindow.setPosition(Math.round(drag.bounds.x + dx), Math.round(drag.bounds.y + dy));
  });
  onPet('pet:drag-end', () => {
    if (!drag) return;
    const current = drag; drag = null;
    const point = screen.getCursorScreenPoint();
    if (!current.moved && Math.hypot(point.x-current.start.x, point.y-current.start.y) <= 6 && Date.now()-current.at <= 350) handleClick(point);
    else {
      const bounds = petWindow.getBounds();
      petWindow.setBounds(clampBounds(bounds, screen.getDisplayMatching(bounds).workArea));
      send('pet:reaction', { type: 'drop' }); sfx('drop_plop');
      if (Math.random() < .4) say('drag');
    }
    saveState(); cursorHit();
  });
  onPet('pet:drag-cancel', () => { drag = null; cursorHit(); });
  ipcMain.on('overlay:done', (event, token) => {
    const entry = [...overlays.values()].find(entry => !entry.win.isDestroyed() && entry.win.webContents === event.sender);
    if (entry) finishOverlay(entry, token);
  });
  const panelOnly = event => { if (disposed || !panelWindow || panelWindow.isDestroyed() || event.sender !== panelWindow.webContents) throw new Error('不允许的设置请求'); };
  ipcMain.handle('panel:state', event => { panelOnly(event); return { hasKey: vault.has(), style: cfg.accessory.style, audio: { enabled: cfg.audio.enabled, masterVolume: cfg.audio.masterVolume }, balanceBridge: Boolean(process.env.DSH_WHALE_BALANCE_URL) }; });
  ipcMain.handle('panel:style', (event, value) => {
    panelOnly(event); if (!['off', 'male', 'female', 'both'].includes(value)) throw new Error('挂件选项无效');
    if (!setting(['accessory', 'style'], value)) throw new Error('挂件设置未能保存');
    return true;
  });
  ipcMain.handle('panel:audio', (event, value) => {
    panelOnly(event);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('音量参数无效');
    const patch = {};
    if (value.masterVolume !== undefined) {
      if (typeof value.masterVolume !== 'number' || !Number.isFinite(value.masterVolume)) throw new Error('音量参数无效');
      patch.masterVolume = Math.min(1, Math.max(0, value.masterVolume));
    }
    if (value.enabled !== undefined) {
      if (typeof value.enabled !== 'boolean') throw new Error('静音参数无效');
      patch.enabled = value.enabled;
    }
    if (!Object.keys(patch).length) throw new Error('音量参数无效');
    for (const [key, next] of Object.entries(patch)) if (!setting(['audio', key], next)) throw new Error('音量设置未能保存');
    return { enabled: cfg.audio.enabled, masterVolume: cfg.audio.masterVolume };
  });
  ipcMain.handle('panel:forget', event => { panelOnly(event); vault.remove(); send('pet:balance', null); return true; });
  ipcMain.handle('panel:balance', async (event, key) => {
    panelOnly(event);
    if (balanceBusy) return { error: '正在查询，请稍候' };
    balanceBusy = true;
    try {
      if (key !== undefined && (typeof key !== 'string' || key.length > 220)) throw new Error('密钥格式无效');
      // 手动填写的 Key 优先（直连官方接口）；留空时用 DSH Host 桥接（账号登录态 / DSH 凭据里的 key）。
      let saved = '';
      if (!key?.trim() && vault.has()) saved = vault.read();
      const actual = key?.trim() || saved;
      const result = await requestBalance(actual || undefined);
      if (key?.trim()) vault.save(actual);
      send('pet:balance', result);
      return { data: result };
    } catch (error) { return { error: error.message }; }
    finally { balanceBusy = false; }
  });
}
function resetDisplays() {
  hideOverlays();
  for (const entry of [...overlays.values()]) entry.win.destroy();
  if (petWindow && !petWindow.isDestroyed()) { state.position = petWindow.getBounds(); resizePet(); }
  if (cfg.fx.prewarmOverlay && cfg.fx.mode !== 'off') createOverlay(screen.getPrimaryDisplay());
}
const ready = app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data|blob|devtools):/.test(details.url) }));
  updateMask();
  const display = screen.getPrimaryDisplay();
  petWindow = safeWindow({ ...cornerBounds(layout(cfg.pet.size, display.workArea, aspect), display.workArea, cfg.pet), focusable: false,
    alwaysOnTop: cfg.pet.alwaysOnTop, webPreferences: { preload: path.join(__dirname, 'preload-pet.js') } });
  setPetInteractive(false); registerIPC();
  await petWindow.loadFile(path.join(__dirname, 'pet/index.html'));
  resizePet(); send('pet:init', { config: cfg, petHeight, clickCount: state.clickCount });
  poll = setInterval(cursorHit, 60);
  tray = new Tray(nativeImage.createFromPath(path.join(packageRoot, 'assets/icon.png')));
  tray.setToolTip('座头鲸 · 右键设置 / 双击查看余额');
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuItems())));
  tray.on('double-click', openPanel);
  watcher = fs.watch(userRoot, (_, file) => {
    if (file !== 'config.jsonc' && file !== 'lines.json') return;
    clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 300);
  });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, resetDisplays);
  powerMonitor.on('resume', resetDisplays);
  scheduleIdle();
  if (cfg.fx.prewarmOverlay && cfg.fx.mode !== 'off') createOverlay(display);
  if (pendingWarning) reportWarning();
  else if (cfg.pet.introEffect) { send('pet:reaction', { type: 'drop' }); sfx('drop_plop'); say('welcome'); }
  console.log('[鲸鱼桌宠] 已就绪');
});
app.on('window-all-closed', () => { /* 托盘保留恢复入口，隐藏不退出。 */ });
app.on('before-quit', () => {
  disposed = true; if (petWindow) saveState(); hideOverlays(); watcher?.close();
  for (const timer of [poll, deepTimer, soundTimer, speechTimer, reloadTimer]) clearTimeout(timer);
  tray?.destroy();
});
const hostPid = Number(process.env.DSH_WHALE_HOST_PID);
if (Number.isSafeInteger(hostPid) && hostPid > 0) {
  // Windows Electron 的管道 stdin 会直接结束，不能用它判断父进程存活。
  for (const stream of [process.stdout, process.stderr]) stream.on('error', error => {
    if (['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) app.quit();
  });
  const liveness = setInterval(() => { try { process.kill(hostPid, 0); } catch (error) { if (error.code === 'ESRCH') app.quit(); } }, 1000);
  liveness.unref();
}
process.on('SIGTERM', () => app.quit());
process.on('uncaughtException', error => { console.error(`[鲸鱼桌宠] 异常退出：${error.stack}`); app.exit(1); });
process.on('unhandledRejection', error => { console.error(`[鲸鱼桌宠] 未处理错误：${error?.stack || error}`); app.exit(1); });
module.exports = { ready, runtime: () => ({ petWindow, panelWindow, overlays, cfg, userRoot, state, openPanel, reload, playRipple, handleClick, menuItems, setPetInteractive, cursorHit }) };
