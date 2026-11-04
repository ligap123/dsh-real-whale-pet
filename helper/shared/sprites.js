// 所有水波、水滴和气泡各生成一张静态贴图，播放时只做变换与叠加。
(() => {
  const create = (size, paint) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    paint(canvas.getContext('2d'), size); return canvas;
  };
  const ring = create(768, (ctx, n) => {
    const c = n / 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(c, c, 304 + i * 8, 0, Math.PI * 2);
      ctx.strokeStyle = ['rgba(116,201,230,.12)', 'rgba(231,252,255,.78)', 'rgba(18,85,117,.32)'][i];
      ctx.lineWidth = [19, 2.4, 5][i]; ctx.stroke();
    }
    let seed = 37;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 550; i++) {
      const a = random() * Math.PI * 2, radius = 312 + (random()-.5) * 13;
      ctx.fillStyle = `rgba(239,252,255,${.15 + random()*.5})`;
      ctx.beginPath(); ctx.ellipse(c + Math.cos(a)*radius, c+Math.sin(a)*radius, .5+random()*2.5, .5+random()*1.1, a, 0, Math.PI*2); ctx.fill();
    }
  });
  const bubble = create(64, (ctx, n) => {
    const gradient = ctx.createRadialGradient(22, 17, 1, 32, 32, 28);
    gradient.addColorStop(0, 'rgba(255,255,255,.6)'); gradient.addColorStop(.2, 'rgba(165,227,247,.04)');
    gradient.addColorStop(.84, 'rgba(119,204,233,.04)'); gradient.addColorStop(.96, 'rgba(209,246,255,.6)'); gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, n, n);
    ctx.strokeStyle = 'rgba(244,253,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(30, 30, 22, 3.7, 4.5); ctx.stroke();
  });
  const droplet = create(64, ctx => {
    ctx.save(); ctx.translate(32, 32); ctx.scale(.5, 1);
    const gradient = ctx.createRadialGradient(-5, -9, 1, 0, 0, 26);
    gradient.addColorStop(0, 'rgba(250,255,255,.9)'); gradient.addColorStop(.4, 'rgba(157,223,245,.12)');
    gradient.addColorStop(.9, 'rgba(190,238,253,.6)'); gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI*2); ctx.fill(); ctx.restore();
  });
  window.WaterSprites = { ring, bubble, droplet };
})();
