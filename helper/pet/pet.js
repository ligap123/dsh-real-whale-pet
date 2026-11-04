(() => {
  const bridge = window.whaleBridge, audio = new window.WhaleAudio(bridge);
  // 测试与排障钩子：电子回归用它确认音量是否真的作用到 WebAudio 主增益。
  window.__whaleAudio = audio;
  const whale = document.getElementById('whale'), bubble = document.getElementById('bubble');
  const male = document.getElementById('accessory-male'), female = document.getElementById('accessory-female');
  const balance = document.getElementById('balance'), missing = document.getElementById('missing');
  let config, imageURL, alphaCanvas, bubbleTimer, bubbleEnd = 0, pointer, reaction, localFrame;
  function rect(element) {
    if (element.hidden) return null;
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function regions() { bridge.send('pet:regions', { whale: rect(whale), bubble: rect(bubble), accessory: [rect(male), rect(female)].filter(Boolean), balance: rect(balance), fallback: rect(missing) }); }
  async function loadWhale() {
    try {
      const bytes = await bridge.readAsset('whale/whale-hero.png'); if (!bytes) throw new Error('缺少鲸鱼图');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      await new Promise((resolve, reject) => { whale.onload = resolve; whale.onerror = reject; whale.src = url; });
      if (imageURL) URL.revokeObjectURL(imageURL); imageURL = url;
      alphaCanvas = document.createElement('canvas'); alphaCanvas.width = whale.naturalWidth; alphaCanvas.height = whale.naturalHeight;
      alphaCanvas.getContext('2d', { willReadFrequently: true }).drawImage(whale, 0, 0);
      whale.hidden = false; missing.hidden = true;
    } catch { whale.hidden = true; missing.hidden = false; }
    regions();
  }
  function hit(event) {
    if (!alphaCanvas || whale.hidden) return false;
    const r = whale.getBoundingClientRect();
    const x = Math.floor((event.clientX-r.x)/r.width*alphaCanvas.width), y = Math.floor((event.clientY-r.y)/r.height*alphaCanvas.height);
    return x >= 0 && y >= 0 && x < alphaCanvas.width && y < alphaCanvas.height && alphaCanvas.getContext('2d').getImageData(x, y, 1, 1).data[3] > 24;
  }
  function configure(data) {
    config = data.config;
    document.body.style.setProperty('--pet-height', `${data.petHeight}px`);
    const style = config.accessory.style;
    male.hidden = !(style === 'male' || style === 'both');
    female.hidden = !(style === 'female' || style === 'both');
    audio.configure(config.audio, data.quiet);
    if (!config.speech.enabled || data.quiet) closeBubble();
    requestAnimationFrame(regions);
  }
  function closeBubble() { clearTimeout(bubbleTimer); bubble.hidden = true; bubbleEnd = 0; bridge.send('pet:speech-close'); regions(); }
  function speak(data) {
    clearTimeout(bubbleTimer); bubble.textContent = data.text; bubble.hidden = false; bubbleEnd = Date.now()+data.ms;
    bubbleTimer = setTimeout(closeBubble, data.ms); regions();
  }
  function react(type) {
    reaction?.cancel();
    reaction = whale.animate(type === 'drop' ? [ { transform: 'scale(.97,1.03)' }, { transform: 'scale(1.035,.96)' }, { transform: 'scale(1)' } ] :
      [ { transform: 'scale(1)' }, { transform: 'scale(1.06,.92) rotate(-1deg)', offset: .22 }, { transform: 'scale(.98,1.03)', offset: .62 }, { transform: 'scale(1)' } ],
      { duration: type === 'drop' ? 520 : 450, easing: 'cubic-bezier(.2,.8,.3,1)' });
    if (type === 'drop') localRipple();
  }
  function localRipple() {
    cancelAnimationFrame(localFrame);
    const canvas = document.getElementById('drop'); canvas.width = innerWidth; canvas.height = innerHeight;
    const ctx = canvas.getContext('2d'), start = performance.now();
    const frame = now => {
      const p = Math.min(1, (now-start)/700); ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (p >= 1) return;
      ctx.save(); ctx.translate(innerWidth*.56, innerHeight-46); ctx.scale(1,.28); ctx.globalAlpha = (1-p)*.65;
      const size = 80+p*240; ctx.drawImage(WaterSprites.ring, -size/2, -size/2, size, size); ctx.restore();
      localFrame = requestAnimationFrame(frame);
    }; localFrame = requestAnimationFrame(frame);
  }
  whale.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !hit(event)) return;
    event.preventDefault(); whale.setPointerCapture(event.pointerId);
    pointer = { x: event.screenX, y: event.screenY, dragging: false, lastSqueak: 0 };
    audio.play('click_boing'); react('click'); bridge.send('pet:drag-start');
  });
  whale.addEventListener('pointermove', event => {
    whale.style.cursor = pointer ? 'grabbing' : hit(event) ? 'grab' : 'default';
    if (!pointer) return;
    const distance = Math.hypot(event.screenX-pointer.x, event.screenY-pointer.y);
    if (distance > 6) { pointer.dragging = true; document.body.classList.add('dragging'); }
    if (pointer.dragging) {
      bridge.send('pet:drag-move');
      if (performance.now()-pointer.lastSqueak > 400) { audio.play('drag_squeak', { pitch: Math.min(7, distance/90) }); pointer.lastSqueak = performance.now(); }
    }
  });
  whale.addEventListener('pointerup', event => {
    if (!pointer || event.button !== 0) return;
    pointer = null; document.body.classList.remove('dragging'); bridge.send('pet:drag-end');
    if (whale.hasPointerCapture(event.pointerId)) whale.releasePointerCapture(event.pointerId);
  });
  whale.addEventListener('pointercancel', () => { pointer = null; document.body.classList.remove('dragging'); bridge.send('pet:drag-cancel'); });
  document.addEventListener('contextmenu', event => { event.preventDefault(); pointer = null; bridge.send('pet:drag-cancel'); bridge.send('pet:context-menu'); });
  bubble.addEventListener('click', closeBubble);
  balance.addEventListener('click', () => bridge.send('pet:open-panel'));
  missing.addEventListener('click', () => bridge.send('pet:context-menu'));
  for (const button of [male, female]) button.addEventListener('click', () => bridge.send('pet:open-panel'));
  bridge.on('pet:init', data => { configure(data); void loadWhale(); void audio.warm(); });
  bridge.on('pet:config', configure);
  bridge.on('pet:reload', () => { void loadWhale(); audio.buffers.clear(); void audio.warm(); });
  bridge.on('pet:sfx', data => audio.play(data.id, data));
  bridge.on('pet:speech', speak); bridge.on('pet:speech-close', closeBubble);
  bridge.on('pet:reaction', data => react(data.type));
  bridge.on('pet:balance', data => { document.getElementById('balance-text').textContent = data ? `${data.rows[0].currency === 'CNY' ? '¥' : '$'}${data.rows[0].total}` : '余额'; regions(); });
  addEventListener('resize', regions);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && bubbleEnd && Date.now() >= bubbleEnd) closeBubble(); });
})();
