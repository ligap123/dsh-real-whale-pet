class WhaleAudio {
  constructor(bridge) {
    this.bridge = bridge; this.buffers = new Map(); this.voices = []; this.cooldowns = new Map(); this.config = {}; this.lastEvent = Date.now();
    setInterval(() => { if (this.ctx?.state === 'running' && Date.now()-this.lastEvent > 60000 && !this.voices.some(v => v.loop)) this.ctx.suspend(); }, 15000);
  }
  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12; this.compressor.knee.value = 18; this.compressor.ratio.value = 6;
    this.master.connect(this.compressor); this.compressor.connect(this.ctx.destination);
    this.configure(this.config, this.muted);
  }
  configure(config, muted = false) {
    this.config = config; this.muted = muted;
    if (this.master) {
      // 直接写 gain.value（并清掉旧自动化）：setTargetAtTime 在长时间播放后偶发不再推进，
      // 会导致菜单/面板调音量看起来"没反应"，这里改用立即生效的赋值。
      const gain = this.master.gain, target = config.enabled && !muted ? config.masterVolume : 0;
      try { gain.cancelScheduledValues(this.ctx.currentTime); } catch { /* 忽略未支持的情况 */ }
      gain.value = target;
    }
    if (!config.ambient || !config.enabled || muted) this.voices.filter(v => v.loop).forEach(v => v.source.stop());
    else if (this.buffers.has('ambient_underwater') && !this.voices.some(v => v.loop)) this.play('ambient_underwater', { volume: .04, loop: true });
  }
  async warm() {
    this.init();
    const names = ['click_boing', 'splash_big', 'drag_squeak', 'drop_plop', 'bubble_blip', 'deep_song', 'rare_airhorn', 'ambient_underwater',
      ...Array.from({ length: 7 }, (_, i) => `combo_${i+1}`), ...Array.from({ length: 5 }, (_, i) => `moan_idle_${i+1}`)];
    await Promise.all(names.map(async id => {
      try { const bytes = await this.bridge.readAsset(`sfx/${id}.wav`); if (bytes) this.buffers.set(id, await this.ctx.decodeAudioData(new Uint8Array(bytes).buffer)); }
      catch { this.buffers.delete(id); }
    }));
    this.configure(this.config, this.muted);
  }
  play(id, options = {}) {
    if (!this.config.enabled || this.muted) return;
    this.init(); this.lastEvent = Date.now();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const family = id.startsWith('moan') ? 'moan' : id.startsWith('combo') ? 'combo' : id;
    const cooldown = ({ click_boing: 120, combo: 120, moan: 8000, deep_song: 900000, drag_squeak: 400 })[family] || 60;
    if (Date.now() - (this.cooldowns.get(family) || 0) < cooldown) return;
    const priority = /click|combo|splash/.test(id) ? 2 : /moan|drag|ambient/.test(id) ? 0 : 1;
    if (this.voices.length >= 4) {
      const victim = this.voices.find(v => v.priority <= priority && !v.loop) || this.voices.find(v => v.priority <= priority);
      if (!victim) return;
      victim.source.stop(); this.voices = this.voices.filter(v => v !== victim);
    }
    this.cooldowns.set(family, Date.now());
    const gain = this.ctx.createGain();
    const levels = { click_boing: .65, splash_big: .6, drag_squeak: .25, drop_plop: .5, bubble_blip: .2, deep_song: .34, rare_airhorn: .45 };
    // 长鲸叫最容易显得吵，单独压低一档。
    gain.gain.value = options.volume ?? levels[id] ?? (family === 'moan' ? .3 : .38); gain.connect(this.master);
    let source;
    if (this.buffers.has(id)) {
      source = this.ctx.createBufferSource(); source.buffer = this.buffers.get(id);
      source.playbackRate.value = 2 ** ((options.pitch || 0) / 12); source.loop = Boolean(options.loop);
    } else {
      if (options.loop) return;
      source = this.ctx.createOscillator();
      source.frequency.setValueAtTime(id === 'click_boing' ? 420 : 110, this.ctx.currentTime);
      source.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + .24);
      gain.gain.setValueAtTime(.3, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + .25);
      source.stop(this.ctx.currentTime + .26);
    }
    const voice = { source, gain, priority, family, loop: Boolean(options.loop) };
    this.voices.push(voice); source.connect(gain);
    source.onended = () => { this.voices = this.voices.filter(v => v !== voice); source.disconnect(); gain.disconnect(); };
    if (id === 'splash_big') for (const v of this.voices.filter(v => v.family === 'moan')) {
      const previous = v.gain.gain.value; v.gain.gain.setTargetAtTime(previous*.5, this.ctx.currentTime, .02);
      v.gain.gain.setTargetAtTime(previous, this.ctx.currentTime+.3, .1);
    }
    source.start();
  }
}
window.WhaleAudio = WhaleAudio;
