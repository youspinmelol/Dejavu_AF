// 오디오: Unity AudioSource / GameSfx / VoiceBank / 코드로 만든 소리(사이렌, 총성, 셔터, TV 클릭 등) 포팅
'use strict';

const Audio = {
  ctx: null, buffers: {}, loading: {}, failed: {}, html: false, buses: {}, handles: new Set(),
  listener: { x: 0, z: 0, yaw: 0 },
  voiceMap: null,
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.gestured && Input.anyPressed) {
        // 첫 입력: 자동재생 정책으로 막혔던 소리를 다시 틀고, 나머지 클립을 미리 불러온다
        this.gestured = true;
        for (const h of this.handles) if (h.el && h.el.paused && !h.stopped) h.el.play().catch(() => { });
        this.preload(window.AUDIO_FILES || []);
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.html = true; return; }
    this.ctx = new AC();
    const mk = (parent) => { const g = this.ctx.createGain(); g.connect(parent); return g; };
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 6; comp.connect(this.ctx.destination);
    this.buses.master = mk(comp);
    for (const c of ['sfx', 'voice', 'ambience', 'jumpscare', 'music']) this.buses[c] = mk(this.buses.master);
    this.applyVolumes();
    // file:// 에서는 fetch 가 막혀 HTMLAudio 로 대체
    if (location.protocol === 'file:') this.html = true;
  },
  applyVolumes() {
    if (!this.ctx) return;
    this.buses.master.gain.value = Settings.Volume;
    this.buses.sfx.gain.value = Settings.SfxVolume;
    this.buses.voice.gain.value = Settings.VoiceVolume;
    this.buses.ambience.gain.value = Settings.AmbienceVolume;
    this.buses.jumpscare.gain.value = Settings.JumpScareVolume;
    this.buses.music.gain.value = 1;
    for (const h of this.handles) if (h.el) h.applyHtmlVol();
  },
  catVol(cat) {
    const m = Settings.Volume;
    return m * ({ sfx: Settings.SfxVolume, voice: Settings.VoiceVolume, ambience: Settings.AmbienceVolume, jumpscare: Settings.JumpScareVolume, music: 1 }[cat] ?? 1);
  },
  url(name) { return 'assets/audio/' + encodeURIComponent(name) + '.ogg'; },
  load(name) {
    if (!name || this.buffers[name] || this.loading[name] || this.failed[name]) return this.loading[name];
    if (this.html || !this.ctx) return null;
    this.loading[name] = fetch(this.url(name)).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => this.ctx.decodeAudioData(b)).then(buf => { this.buffers[name] = buf; delete this.loading[name]; return buf; })
      .catch(() => { this.failed[name] = true; delete this.loading[name]; this.html = this.html || location.protocol === 'file:'; });
    return this.loading[name];
  },
  preload(names) { for (const n of names) this.load(n); },
  duration(name) { const b = this.buffers[name]; return b ? b.duration : (this.durations[name] || 0); },
  durations: {},

  // name: 클립 이름 또는 AudioBuffer
  play(name, o = {}) {
    if (!name) return null;
    this.unlock();
    const h = new SoundHandle(o);
    if (name instanceof AudioBuffer) { h.startBuffer(name); return h; }
    if (name instanceof ProcClip) { // 코드로 만든 소리
      if (this.ctx && !this.html) { h.startBuffer(name.buffer()); return h; }
      h.startHtml(name.wavUrl()); return h;
    }
    const buf = this.buffers[name];
    if (buf && !this.html) { h.startBuffer(buf); return h; }
    if (!this.html && this.ctx && !this.failed[name]) {
      // 아직 로드 전: 로드 후 재생 (늦으면 건너뜀)
      const p = this.load(name), t0 = performance.now();
      if (p) p.then(b => { if (b && !h.stopped && performance.now() - t0 < 1500) h.startBuffer(b); });
      return h;
    }
    h.startHtml(this.url(name));
    return h;
  },
  update(listener) {
    if (listener) Object.assign(this.listener, listener);
    for (const h of this.handles) h.update();
  },
  stopAll(cat) { for (const h of [...this.handles]) if (!cat || h.cat === cat) h.stop(); },

  // VoiceBank.Find
  voice(text) {
    if (!text) return null;
    if (!this.voiceMap) { this.voiceMap = {}; for (const e of (window.VOICES || [])) if (e.clip && e.text) this.voiceMap[e.text.trim()] = e.clip; }
    return this.voiceMap[text.trim()] || null;
  },
  // JumpScare.StretchVoice: 말끝 모음을 늘이며 음을 낮춘다 (근사: 마지막 구간을 반복 재생하며 피치 하강)
  playStretched(name, stretch, endPitch, o = {}) {
    const buf = this.buffers[name];
    if (!buf || this.html) { const h = this.play(name, o); return { head: this.duration(name) || 1.5, total: (this.duration(name) || 1.5) + stretch, handle: h, stop() { h && h.stop(); } }; }
    const head = Math.max(0.2, buf.duration - 0.22);
    const a = this.play(buf, o);
    const tail = new SoundHandle(Object.assign({}, o));
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.loopStart = Math.max(0, buf.duration - 0.2); src.loopEnd = buf.duration - 0.02;
    tail.connectSource(src);
    const t0 = ctx.currentTime + head;
    src.playbackRate.setValueAtTime(1, t0); src.playbackRate.linearRampToValueAtTime(endPitch, t0 + stretch);
    tail.gain.gain.setValueAtTime(0, ctx.currentTime); tail.gain.gain.setValueAtTime(0, t0 - 0.01);
    tail.gain.gain.linearRampToValueAtTime(tail.baseVol(), t0 + 0.05);
    src.start(t0, src.loopStart); src.stop(t0 + stretch);
    return { head, total: head + stretch, handle: a, tail, stop() { a.stop(); tail.stop(); } };
  }
};

class SoundHandle {
  constructor(o) {
    this.cat = o.cat || 'sfx'; this.vol = o.vol ?? 1; this.rate = o.rate ?? 1; this.loop = !!o.loop;
    this.emitter = o.emitter || null; this.min = o.min ?? 2; this.max = o.max ?? 25; this.offset = o.offset || 0;
    this.lowpass = o.lowpass || 0; this.stopped = false; this.ended = false; this.startedAt = 0; this.dur = 0;
    this.onend = o.onend || null;
    Audio.handles.add(this);
  }
  baseVol() { return this.vol * this.spatial(); }
  spatial() {
    if (!this.emitter) return 1;
    const e = typeof this.emitter === 'function' ? this.emitter() : this.emitter;
    if (!e) return 1;
    const L = Audio.listener, d = dist2(e.x, e.z, L.x, L.z);
    if (d <= this.min) return 1;
    return clamp01(1 - (d - this.min) / Math.max(0.01, this.max - this.min));
  }
  connectSource(src) {
    const ctx = Audio.ctx;
    this.src = src; this.gain = ctx.createGain(); this.gain.gain.value = this.baseVol();
    let node = src;
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = this.lowpass || 22000;
    node.connect(this.filter); node = this.filter;
    if (ctx.createStereoPanner) { this.pan = ctx.createStereoPanner(); node.connect(this.pan); node = this.pan; }
    node.connect(this.gain); this.gain.connect(Audio.buses[this.cat] || Audio.buses.sfx);
    src.onended = () => { this.ended = true; Audio.handles.delete(this); this.onend && this.onend(); };
  }
  startBuffer(buf) {
    if (this.stopped) return;
    const src = Audio.ctx.createBufferSource(); src.buffer = buf; src.loop = this.loop; src.playbackRate.value = this.rate;
    this.connectSource(src); this.dur = buf.duration; this.startedAt = Audio.ctx.currentTime;
    src.start(0, this.offset % buf.duration);
    this.update();
  }
  startHtml(url) {
    if (this.stopped) return;
    const el = new window.Audio(url); this.el = el; el.loop = this.loop; el.playbackRate = this.rate;
    try { el.preservesPitch = false; el.mozPreservesPitch = false; el.webkitPreservesPitch = false; } catch (e) { }
    this.applyHtmlVol();
    el.addEventListener('loadedmetadata', () => { this.dur = el.duration; Audio.durations[url] = el.duration; if (this.offset) el.currentTime = this.offset % el.duration; });
    el.addEventListener('ended', () => { this.ended = true; Audio.handles.delete(this); this.onend && this.onend(); });
    el.play().catch(() => { });
    this.startedAt = performance.now() / 1000;
  }
  applyHtmlVol() { if (this.el) this.el.volume = clamp01(this.baseVol() * Audio.catVol(this.cat)); }
  get time() {
    if (this.el) return this.el.currentTime;
    if (!Audio.ctx || !this.startedAt) return 0;
    return (Audio.ctx.currentTime - this.startedAt) * this.rate;
  }
  get playing() { return !this.stopped && !this.ended; }
  setVol(v) { this.vol = v; this.update(); }
  setRate(r) { this.rate = r; if (this.src) this.src.playbackRate.value = r; if (this.el) this.el.playbackRate = clamp(r, 0.07, 16); }
  setLowpass(f) { this.lowpass = f; if (this.filter) this.filter.frequency.value = f; }
  pause() { if (this.el) this.el.pause(); else if (Audio.ctx && this.gain) this.gain.gain.value = 0; this.paused = true; }
  update() {
    if (this.stopped) return;
    if (this.el) { this.applyHtmlVol(); return; }
    if (!this.gain) return;
    if (!this.paused) this.gain.gain.value = this.baseVol();
    if (this.pan && this.emitter) {
      const e = typeof this.emitter === 'function' ? this.emitter() : this.emitter;
      if (e) {
        const L = Audio.listener, ang = (yawTo(L.x, L.z, e.x, e.z) - L.yaw) * DEG;
        this.pan.pan.value = clamp(Math.sin(ang) * 0.8, -1, 1);
      }
    }
  }
  stop() {
    if (this.stopped) return; this.stopped = true; Audio.handles.delete(this);
    try { if (this.src) this.src.stop(); } catch (e) { }
    if (this.el) { this.el.pause(); this.el.src = ''; }
  }
}

// 코드로 만든 소리 (원본 C# 의 AudioClip.Create 루틴을 그대로 옮김)
class ProcClip {
  constructor(name, rate, fn) { this.name = name; this.rate = rate; this.fn = fn; this.float = null; this._buf = null; this._url = null; }
  data() { if (!this.float) this.float = this.fn(); return this.float; }
  get length() { return this.data().length / this.rate; }
  buffer() {
    if (!this._buf) { const d = this.data(); this._buf = Audio.ctx.createBuffer(1, d.length, this.rate); this._buf.copyToChannel(d, 0); }
    return this._buf;
  }
  wavUrl() {
    if (this._url) return this._url;
    const d = this.data(), n = d.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, this.rate, true); v.setUint32(28, this.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, clamp(d[i], -1, 1) * 32767, true);
    this._url = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    return this._url;
  }
}
// System.Random 은 재현하지 않고 시드 고정 난수로 대체
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const Proc = {
  // FilmCamera.MakeClick
  shutter: new ProcClip('Shutter', 44100, () => {
    const rate = 44100, len = (rate * 0.16) | 0, d = new Float32Array(len), r = seeded(11);
    const burst = (st, amp, dec) => { for (let i = st; i < len; i++) { const t = (i - st) / rate; d[i] += (r() * 2 - 1) * amp * Math.exp(-t * dec); } };
    burst(0, 0.8, 180); burst((rate * 0.075) | 0, 0.6, 120); return d;
  }),
  empty: new ProcClip('Empty', 44100, () => {
    const rate = 44100, len = (rate * 0.05) | 0, d = new Float32Array(len), r = seeded(13);
    for (let i = 0; i < len; i++) { const t = i / rate; d[i] += (r() * 2 - 1) * 0.8 * Math.exp(-t * 180); } return d;
  }),
  // EndingDirector.PlayClick
  tvClick: new ProcClip('TvClick', 44100, () => {
    const n = 30870, d = new Float32Array(n), r = seeded(5);
    for (let i = 0; i < n; i++) {
      const t = i / 44100, a = (r() * 2 - 1) * Math.exp(-t * 180);
      const b = Math.sin(Math.PI * 140 * t) * Math.exp(-t * 9) * clamp01((t - 0.03) * 40);
      const c = Math.sin(Math.PI * 15600 * t) * 0.05 * clamp01((t - 0.05) * 10) * Math.exp(-t * 2.5);
      d[i] = a * 0.8 + b * 0.6 + c;
    } return d;
  }),
  // LostEndingDirector.SirenClip
  siren: new ProcClip('Siren', 44100, () => {
    const n = (44100 * 4.8) | 0, d = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / 44100, k = 0.5 - 0.5 * Math.cos(Math.PI * 2 * t / 2.4), f = lerp(650, 1350, k);
      ph += Math.PI * 2 * f / 44100; const s = Math.sin(ph); d[i] = (s + 0.3 * Math.sign(s)) * 0.35;
    } return d;
  }),
  // LostEndingDirector.Gunshot
  gunshot: new ProcClip('Gunshot', 44100, () => {
    const n = 52920, d = new Float32Array(n), r = seeded(3); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / 44100, w = r() * 2 - 1; lp += (w - lp) * 0.5;
      const a = w * Math.exp(-t * 60), b = lp * Math.exp(-t * 9), c = Math.sin(Math.PI * 2 * (60 - 30 * t) * t) * Math.exp(-t * 6);
      const e = t > 0.12 ? lp * 0.25 * Math.exp(-(t - 0.12) * 4) : 0;
      d[i] = Math.tanh((a * 1.4 + b * 1.2 + c * 0.9 + e) * 1.6);
    } return d;
  }),
  // JumpScare.ProceduralSting (GameSfx.jumpScareStinger 가 비어 있어 원본도 이 소리를 씀)
  sting: new ProcClip('Sting', 44100, () => {
    const n = 70560, d = new Float32Array(n), r = seeded(7); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / 44100, att = clamp01(t / 0.004);
      const a = Math.sin(Math.PI * 2 * (48 - 18 * t) * t) * Math.exp(-t * 3.2);
      const w = r() * 2 - 1; lp += (w - lp) * 0.35; const b = lp * Math.exp(-t * 7);
      const f1 = 1480 - 260 * t, f2 = 1555 - 300 * t;
      const c = (Math.sin(Math.PI * 2 * f1 * t) + Math.sin(Math.PI * 2 * f2 * t)) * 0.5 * (0.6 + 0.4 * Math.sin(Math.PI * 26 * t)) * Math.exp(-t * 1.6);
      d[i] = Math.tanh(att * (a * 1.1 + b * 1.3 + c * 0.55) * 1.8);
    } return d;
  }),
};

// GameSfx.asset 매핑 (pathID → 클립 이름으로 확인)
const SFX = {
  streetAmbience: 'Night_city', stationAmbience: 'Station_empty', clueFound: 'horror_hit_low',
  rewindLoop: 'vhs_rewind', rewindStatic: 'vhs_static', jumpScareSubway: 'jumpscare_sound1', jumpScareGirl: 'jumpscare_sound2',
  ghostWhoosh: 'ghost_whoosh', menuMove: 'Menu_Move', menuSelect: 'Menu_Select', menuCancel: 'Menu_Cancel',
  sfxVolume: 0.8, menuVolume: 0.8, ambienceVolume: 0.45,
  footsteps: ['girl_walk1', 'girl_walk2', 'girl_walk3', 'girl_walk4', 'girl_walk5', 'girl_walk6'],
};
function play2D(name, vol = 1, o = {}) { return Audio.play(name, Object.assign({ vol: vol * SFX.sfxVolume, cat: 'sfx' }, o)); }
function menuMove() { play2D(SFX.menuMove, SFX.menuVolume); }
function menuSelect() { play2D(SFX.menuSelect, SFX.menuVolume); }
function menuCancel() { play2D(SFX.menuCancel, SFX.menuVolume); }
function menuConfirm() { play2D(SFX.menuSelect, SFX.menuVolume, { rate: 2 }); }
function playLoud(clip, vol = 1) { if (!clip) clip = Proc.sting; return Audio.play(clip, { cat: 'jumpscare', vol }); }
function sting(vol = 1) { return playLoud(Proc.sting, vol); }
