(() => {
  const bridge = window.rippleBridge, refraction = document.getElementById('refraction'), canvas = document.getElementById('water');
  const ctx = canvas.getContext('2d'), textures = new Map();
  let gl, frame = 0, serial = 0, current = null, lost = false, lastFrame = 0;
  function resize() {
    const ratio = Math.min(devicePixelRatio, 1.5);
    for (const surface of [canvas, refraction]) { surface.width = Math.round(innerWidth*ratio); surface.height = Math.round(innerHeight*ratio); }
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  async function loadOptional() {
    for (const name of ['foam-ring', 'caustics-tile', 'water-normal', 'noise-tile', 'splash-crown', 'droplets-tile', 'bubbles-atlas']) {
      try {
        const data = await bridge.readAsset(`fx/${name}.png`);
        if (!data) { textures.delete(name); continue; }
        const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
        textures.get(name)?.close(); textures.set(name, image);
      } catch { textures.delete(name); }
    }
  }
  function ensureGL() {
    if (gl && !lost) return true;
    if (lost) { gl?.restore(); return false; }
    try {
      gl = new window.RippleGL(refraction, () => { lost = true; refraction.style.visibility = 'hidden'; });
      for (const [name, index] of [['caustics-tile',1], ['water-normal',2], ['noise-tile',3]]) if (textures.has(name)) gl.texture(index, textures.get(name));
      return true;
    } catch { gl = null; return false; }
  }
  function clear() {
    serial++; cancelAnimationFrame(frame); current = null;
    ctx.clearRect(0,0,innerWidth,innerHeight); if (!lost) gl?.clear();
  }
  function seeded(seed) {
    let value = Math.floor(seed*2147483646)+1;
    return () => { value = value*16807%2147483647; return value/2147483647; };
  }
  function stamp(image, x, y, width, height, angle, alpha, atlas = false) {
    if (alpha <= 0) return;
    ctx.save(); ctx.translate(x,y); ctx.rotate(angle); ctx.globalAlpha = Math.min(1,alpha);
    if (atlas) ctx.drawImage(image, 0,0,image.width/4,image.height/2,-width/2,-height/2,width,height);
    else ctx.drawImage(image,-width/2,-height/2,width,height);
    ctx.restore();
  }
  async function play(payload) {
    clear(); resize(); current = payload;
    const id = serial;
    const minimal = payload.mode === 'minimal';
    let useGL = !minimal && ensureGL();
    refraction.style.visibility = useGL ? 'visible' : 'hidden';
    if (useGL) {
      gl.texture(0,null);
      if (payload.shot) {
        try {
          const shot = await createImageBitmap(new Blob([payload.shot], { type:'image/png' }));
          if (id !== serial) { shot.close(); return; }
          gl.texture(0,shot); shot.close();
        } catch { gl.texture(0,null); }
      }
    }
    // 不让原始截图留在动画对象里，GPU 纹理在结束时也会清空。
    payload.shot = null;
    const random = seeded(payload.seed), count = minimal ? 0 : 72;
    const bubbles = Array.from({ length:count }, () => ({ x:random(), y:random(), size:3+random()*14, speed:50+random()*150, phase:random()*6.28 }));
    const drops = Array.from({ length:minimal ? 0 : 16 }, () => ({ angle:random()*6.28, speed:120+random()*340, size:5+random()*12 }));
    const start = performance.now()+payload.delay;
    const draw = now => {
      if (id !== serial) return;
      const elapsed = now-start;
      if (elapsed < 0) { frame = requestAnimationFrame(draw); return; }
      const p = Math.min(1, elapsed/payload.duration), seconds = elapsed/1000;
      if (p >= 1) { const token = payload.token; clear(); bridge.done(token); return; }
      if ((minimal || lost) && now-lastFrame < 32) { frame = requestAnimationFrame(draw); return; }
      lastFrame = now;
      if (useGL && !lost) gl.draw(payload,p);
      else useGL = false;
      ctx.clearRect(0,0,innerWidth,innerHeight);
      const diagonal = Math.hypot(innerWidth,innerHeight), fade = (1-p)**1.35;
      const ring = textures.get('foam-ring') || WaterSprites.ring;
      for (let i=0; i<(minimal ? 2 : 4); i++) {
        const age = p-i*.045; if (age <= 0) continue;
        const size = Math.pow(Math.min(1,age*2.5),.74)*diagonal*2.25;
        stamp(ring,payload.origin.x,payload.origin.y,size,size*(1-i*.025),i*.79+payload.seed,fade*(minimal ? .48 : .68)*Math.pow(.58,i));
      }
      if (!minimal && !lost) {
        const splash = textures.get('splash-crown');
        if (splash && p<.45) stamp(splash,payload.origin.x,payload.origin.y,160+p*400,100*(1-p),0,(1-p/.45)*.6,true);
        for (const drop of drops) {
          if (p>.58) break;
          const travel = seconds*drop.speed;
          stamp(WaterSprites.droplet,payload.origin.x+Math.cos(drop.angle)*travel,payload.origin.y+Math.sin(drop.angle)*travel+seconds*seconds*240,
            drop.size,drop.size*(1.8-p),drop.angle+1.57,(1-p/.58)*.65);
        }
        for (const bubble of bubbles) {
          if (p<.07) continue;
          const x = payload.origin.x+(bubble.x-.5)*Math.min(innerWidth,1000)+Math.sin(seconds*2+bubble.phase)*16;
          const y = payload.origin.y+(bubble.y-.3)*300-seconds*bubble.speed;
          stamp(textures.get('bubbles-atlas') || WaterSprites.bubble,x,y,bubble.size,bubble.size,0,fade*.64,textures.has('bubbles-atlas'));
        }
        const wet = textures.get('droplets-tile');
        if (wet) stamp(wet,innerWidth/2,innerHeight/2,innerWidth,innerHeight,payload.seed*.2,Math.sin(p*Math.PI)*.18);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  }
  refraction.addEventListener('webglcontextrestored', () => { gl = null; lost = false; });
  bridge.onPlay(payload => { void play(payload).catch(() => { clear(); bridge.done(payload.token); }); });
  bridge.onClear(clear); addEventListener('resize', resize); addEventListener('beforeunload', () => { clear(); gl?.dispose(); for (const image of textures.values()) image.close(); });
  void loadOptional(); resize();
})();
