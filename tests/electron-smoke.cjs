const { app, screen, nativeImage, BrowserWindow, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.DSH_WHALE_USER_ROOT;
fs.writeFileSync(path.join(root, 'config.jsonc'), JSON.stringify({ pet: { introEffect: false }, audio: { enabled: false }, fx: { mode: 'standard', rippleDurationMs: 700 } }));
const helper = require('../helper/main.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, ms = 5000) {
  const start = Date.now(); while (Date.now()-start < ms) { if (await check()) return; await sleep(50); } throw new Error(message);
}
async function run() {
  await helper.ready;
  const runtime = helper.runtime(), pet = runtime.petWindow;
  const errors = [];
  pet.webContents.on('console-message', (_, details) => { if (details.level === 'error') errors.push(details.message); });
  await until(() => pet.webContents.executeJavaScript('document.getElementById("whale").naturalWidth > 0'), '鲸鱼没有加载');
  assert.equal(pet.isFocusable(), false); assert.equal(pet.isAlwaysOnTop(), true);
  assert.equal(pet.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.equal(pet.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(await pet.webContents.executeJavaScript('typeof window.whaleBridge'), 'object');
  fs.writeFileSync(path.join(root, 'config.jsonc'), JSON.stringify({ pet: { introEffect: false }, audio: { enabled: true, masterVolume: 0.7 }, fx: { mode: 'standard', rippleDurationMs: 700 } }));
  helper.runtime().reload();
  await sleep(700);
  const volumeMenu = helper.runtime().menuItems().find(item => item.label === '音量').submenu;
  assert.ok(Array.isArray(volumeMenu) && volumeMenu.length >= 7, '音量档位不足');
  volumeMenu[2].click();
  await sleep(450);
  assert.equal(helper.runtime().cfg.audio.masterVolume, 0.2);
  const menuGain = await pet.webContents.executeJavaScript('window.__whaleAudio.master.gain.value');
  assert.ok(Math.abs(menuGain - 0.2) < 0.03, `右键菜单音量没有作用到 WebAudio 主增益：${menuGain}`);
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/whale/whale-hero.png'));
  const bitmap = image.toBitmap();
  assert.ok(bitmap.some((v,i) => i%4===3 && v===0)); assert.ok(bitmap.some((v,i) => i%4===3 && v===255));
  const preview = path.join(__dirname, '../assets/preview'); fs.mkdirSync(preview, { recursive: true });
  pet.webContents.send('pet:speech', { text: '你忙你的，我在进行深海思考。', ms: 10000 });
  await sleep(100);
  fs.writeFileSync(path.join(preview, 'pet.png'), (await pet.webContents.capturePage()).toPNG());
  const count = runtime.state.clickCount;
  const bounds = pet.getBounds(), point = { x: bounds.x+bounds.width/2, y: bounds.y+bounds.height/2 };
  for (let i=0;i<10;i++) helper.runtime().handleClick(point);
  await sleep(150);
  assert.equal(runtime.state.clickCount, count+10);
  assert.equal(runtime.overlays.size, screen.getAllDisplays().length);
  const overlay = [...runtime.overlays.values()][0];
  assert.equal(overlay.win.isFocusable(), false);
  assert.ok(overlay.win.isVisible());
  assert.equal(await overlay.win.webContents.executeJavaScript('typeof window.rippleBridge'), 'object');
  assert.equal(await overlay.win.webContents.executeJavaScript('document.getElementById("refraction").style.visibility'), 'visible', '本机 WebGL2 未成功运行');
  const fxRoot = path.join(__dirname, '../assets/fx'); fs.mkdirSync(fxRoot, { recursive: true });
  const ringFile = path.join(fxRoot, 'foam-ring.png');
  if (!fs.existsSync(ringFile)) {
    const encoded = await overlay.win.webContents.executeJavaScript('WaterSprites.ring.toDataURL("image/png").split(",")[1]');
    fs.writeFileSync(ringFile, Buffer.from(encoded, 'base64'));
  }
  // 标准模式只捕获透明水波，不将用户桌面截图写入验证产物。
  const waterDataURL = (await overlay.win.webContents.capturePage()).toDataURL();
  const composite = await overlay.win.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(waterDataURL)}; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const context = c.getContext('2d'); context.fillStyle = '#102537'; context.fillRect(0,0,c.width,c.height); context.drawImage(image,0,0);
    return c.toDataURL('image/png').split(',')[1];
  })()`);
  fs.writeFileSync(path.join(preview, 'water.png'), Buffer.from(composite, 'base64'));
  await until(() => !overlay.win.isVisible(), '水波未按时隐藏', 2500);
  await overlay.win.webContents.executeJavaScript('document.getElementById("refraction").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()');
  await sleep(100);
  await helper.runtime().playRipple(point); await sleep(1400);
  await helper.runtime().playRipple(point); await sleep(100);
  assert.equal(await overlay.win.webContents.executeJavaScript('document.getElementById("refraction").style.visibility'), 'visible', 'WebGL 丢失后未恢复');
  await sleep(1400);
  for (const mode of ['minimal', 'cinematic', 'off']) {
    fs.writeFileSync(path.join(root, 'config.jsonc'), JSON.stringify({ pet: { introEffect: false }, audio: { enabled: false }, fx: { mode, rippleDurationMs: 700 } }));
    helper.runtime().reload();
    await helper.runtime().playRipple(point);
    if (mode !== 'off') {
      assert.ok([...runtime.overlays.values()].some(entry => entry.win.isVisible()));
      if (mode === 'cinematic') {
        await sleep(80);
        const currentOverlay = [...runtime.overlays.values()][0];
        const captured = await currentOverlay.win.webContents.executeJavaScript(`(() => { const gl = document.getElementById('refraction').getContext('webgl2'); const p = gl.getParameter(gl.CURRENT_PROGRAM); return gl.getUniform(p, gl.getUniformLocation(p,'uHasShot')); })()`);
        console.log(`真实桌面截图折射：${captured === 1 ? '已启用（仅内存）' : '本机截图失败，已自动标准降级'}`);
      }
      await sleep(1600);
    }
    assert.ok([...runtime.overlays.values()].every(entry => !entry.win.isVisible()));
  }
  fs.writeFileSync(path.join(root, 'config.jsonc'), JSON.stringify({ pet: { introEffect: false }, audio: { enabled: false }, accessory: { style: 'both' }, fx: { mode: 'off' } }));
  helper.runtime().reload();
  await until(() => pet.webContents.executeJavaScript('!document.getElementById("accessory-male").hidden && !document.getElementById("accessory-female").hidden'), '挂件未更新');
  await sleep(120);
  const accessoryLayout = await pet.webContents.executeJavaScript(`(() => {
    const male = document.getElementById('accessory-male'), female = document.getElementById('accessory-female'), whale = document.getElementById('whale');
    const m = male.getBoundingClientRect(), f = female.getBoundingClientRect(), w = whale.getBoundingClientRect();
    return { text: male.textContent, male: { x: m.x, y: m.y }, female: { x: f.x, y: f.y }, whale: { x: w.x, y: w.y, width: w.width, height: w.height } };
  })()`);
  assert.equal(accessoryLayout.text, '🥚🍆🥚');
  assert.ok(accessoryLayout.male.x < accessoryLayout.female.x, '男版挂件应位于女版之后（更靠尾部）');
  assert.ok(accessoryLayout.male.y > accessoryLayout.female.y, '男版挂件应贴在腹面后段、女版在胸腹面');
  assert.ok(accessoryLayout.male.y < accessoryLayout.whale.y + accessoryLayout.whale.height, '男版挂件应落在鲸鱼图范围内');
  const validSize = helper.runtime().cfg.pet.size;
  fs.writeFileSync(path.join(root, 'config.jsonc'), '{\n"pet": ?\n}'); helper.runtime().reload();
  assert.equal(helper.runtime().cfg.pet.size, validSize);
  const xss = '<img src=x onerror="window.__xss=1">';
  pet.webContents.send('pet:speech', { text: xss, ms: 2000 }); await sleep(50);
  assert.equal(await pet.webContents.executeJavaScript('Boolean(window.__xss)'), false);
  assert.equal(await pet.webContents.executeJavaScript('document.getElementById("bubble").textContent'), xss);
  await assert.rejects(pet.webContents.executeJavaScript('window.whaleBridge.readAsset("../../README.md")'), /白名单/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), []);
  helper.runtime().openPanel();
  await until(() => helper.runtime().panelWindow?.webContents.executeJavaScript('document.readyState === "complete"'), '余额面板未就绪');
  const panel = helper.runtime().panelWindow;
  await sleep(100);
  assert.equal(await panel.webContents.executeJavaScript('typeof window.settingsBridge'), 'object');
  assert.equal(await panel.webContents.executeJavaScript('document.querySelector("[data-style=both]").getAttribute("aria-pressed")'), 'true');
  await panel.webContents.executeJavaScript('document.getElementById("mute").click()');
  await sleep(500);
  assert.equal(helper.runtime().cfg.audio.enabled, true, '面板静音按钮没有恢复声音');
  fs.writeFileSync(path.join(preview, 'panel.png'), (await panel.webContents.capturePage()).toPNG());
  await panel.webContents.executeJavaScript(`(() => { const v = document.getElementById('volume'); v.value = 25; v.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  assert.equal(helper.runtime().cfg.audio.masterVolume, 0.25, '面板滑杆没有写入音量');
  const panelGain = await pet.webContents.executeJavaScript('window.__whaleAudio.master.gain.value');
  assert.ok(Math.abs(panelGain - 0.25) < 0.03, `面板音量没有作用到 WebAudio 主增益：${panelGain}`);
  await panel.webContents.executeJavaScript('document.getElementById("mute").click()');
  await sleep(500);
  assert.equal(helper.runtime().cfg.audio.enabled, false, '面板静音按钮没有静音');
  assert.ok(Math.abs((await pet.webContents.executeJavaScript('window.__whaleAudio.master.gain.value')) - 0) < 0.03, '静音没有作用到 WebAudio 主增益');
  // 余额：留空 Key 时走 DSH Host 桥接（模拟账号登录态），并显示来源。
  const badKey = await panel.webContents.executeJavaScript('window.settingsBridge.balance("bad")');
  assert.ok(String(badKey.error || '').includes('有效'), '无效 API Key 应被拒绝');
  await panel.webContents.executeJavaScript(`(() => { document.getElementById('key').value = ''; document.getElementById('balance-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
  await until(() => panel.webContents.executeJavaScript('document.getElementById("amount").textContent.includes("88.88")'), '余额没有经 DSH Host 桥接显示');
  assert.equal(await panel.webContents.executeJavaScript('document.getElementById("status").textContent.includes("来源：DSH 账号")'), true, '余额来源没有标注');
  assert.equal(await panel.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight'), false, '面板内容不应溢出');
  await panel.webContents.executeJavaScript('window.settingsBridge.style("female")');
  assert.equal(helper.runtime().cfg.accessory.style, 'female');
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('config.jsonc.corrupt-')));
  if (fs.existsSync(path.join(root, 'video.mp4'))) {
    panel.hide();
    const videoWindow = new BrowserWindow({ fullscreen: true, frame: false, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    fs.writeFileSync(path.join(root, 'video.html'), '<!doctype html><html><body style="margin:0;background:#123"><video id="v" src="video.mp4" autoplay muted loop style="width:100vw;height:100vh;object-fit:cover"></video></body></html>');
    await videoWindow.loadFile(path.join(root, 'video.html')); videoWindow.show();
    await until(() => videoWindow.webContents.executeJavaScript('document.getElementById("v").currentTime > .15'), '全屏测试视频未播放');
    fs.writeFileSync(path.join(root, 'config.jsonc'), '{"pet":{"introEffect":false},"audio":{"enabled":false},"fx":{"mode":"standard","rippleDurationMs":2200}}');
    helper.runtime().reload();
    const before = await videoWindow.webContents.executeJavaScript('document.getElementById("v").currentTime');
    await helper.runtime().playRipple(point); await sleep(350);
    assert.equal(videoWindow.isFocused(), true, '水波抢走了全屏视频焦点');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 36 } });
    const source = sources.find(source => source.display_id === String(screen.getPrimaryDisplay().id));
    const pixels = source.thumbnail.toBitmap();
    const brightness = pixels.reduce((sum, value, i) => sum+(i%4===3 ? 0 : value), 0)/(pixels.length/4*3);
    assert.ok(brightness > 20, '全屏视频在系统合成截图中呈黑色');
    const after = await videoWindow.webContents.executeJavaScript('document.getElementById("v").currentTime');
    assert.ok(after > before, '水波期间视频时间没有前进');
    console.log(`全屏视频回归通过：播放继续、视频保有焦点、系统画面非黑屏（平均亮度 ${brightness.toFixed(1)}）。`);
    videoWindow.destroy();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Electron 验证通过：透明鲸鱼、沙箱 IPC、十连击、特效四档、自动隐藏、挂件、坏配置、文本安全、余额面板。');
  panel.close();
  assert.ok(BrowserWindow.getAllWindows().length >= 1);
  app.quit();
}
run().catch(error => { console.error(`Electron 验证失败：${error.stack}`); app.exit(1); });
