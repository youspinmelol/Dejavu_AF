// UI: LoopUI(자막·단서·선택지·안내), ScreenFader, HomeMarker, 필름카메라 뷰파인더, 되감기/글리치 효과
'use strict';

const FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const UI = {
  cw: 1920, ch: 1080, s: 1, g: null,
  begin(g, cw, ch) { this.g = g; this.cw = cw; this.ch = ch; this.s = Math.sqrt((cw / 1920) * (ch / 1080)); },
  font(px, w = 600) { return `${w} ${Math.round(px * this.s)}px ${FONT}`; },
  // 간단한 리치 텍스트: <size=NN%>, <color=#hex>, </size>, </color>
  parse(str, base, color) {
    const runs = []; const st = [{ size: base, color }]; let i = 0, cur = '';
    const push = () => { if (cur) { const t = st[st.length - 1]; runs.push({ text: cur, size: t.size, color: t.color }); cur = ''; } };
    while (i < str.length) {
      if (str[i] === '<') {
        const j = str.indexOf('>', i); if (j < 0) { cur += str.slice(i); break; }
        const tag = str.slice(i + 1, j); let m;
        if ((m = /^size=(\d+)%$/.exec(tag))) { push(); st.push(Object.assign({}, st[st.length - 1], { size: base * (+m[1]) / 100 })); }
        else if ((m = /^color=(#[0-9a-fA-F]+)$/.exec(tag))) { push(); st.push(Object.assign({}, st[st.length - 1], { color: m[1].length === 4 ? '#' + [...m[1].slice(1)].map(c => c + c).join('') : m[1] })); }
        else if (tag === '/size' || tag === '/color') { push(); if (st.length > 1) st.pop(); }
        else if (tag === 'b' || tag === '/b') { }
        else cur += str.slice(i, j + 1);
        i = j + 1; continue;
      }
      cur += str[i++];
    }
    push(); return runs;
  },
  // runs → 줄 목록 (자동 줄바꿈). 각 줄: {runs:[{text,size,color,w}], w, h}
  layout(runs, maxW, lineSpacing = 1.25) {
    const g = this.g, lines = []; let line = { runs: [], w: 0, h: 0 };
    const newLine = () => { lines.push(line); line = { runs: [], w: 0, h: 0 }; };
    for (const r of runs) {
      g.font = this.font(r.size);
      const parts = r.text.split('\n');
      parts.forEach((p, pi) => {
        if (pi > 0) { if (!line.h) line.h = r.size * this.s * lineSpacing; newLine(); }
        const words = p.split(/(\s+)/);
        for (const wd of words) {
          if (!wd) continue;
          let ww = g.measureText(wd).width;
          if (line.w + ww > maxW && line.w > 0 && wd.trim()) newLine();
          if (!line.w && !wd.trim()) continue;
          if (ww > maxW) { // 긴 단어: 글자 단위
            for (const c of wd) { const cwid = g.measureText(c).width; if (line.w + cwid > maxW) newLine(); line.runs.push({ text: c, size: r.size, color: r.color, w: cwid }); line.w += cwid; line.h = Math.max(line.h, r.size * this.s * lineSpacing); }
            continue;
          }
          line.runs.push({ text: wd, size: r.size, color: r.color, w: ww }); line.w += ww; line.h = Math.max(line.h, r.size * this.s * lineSpacing);
        }
      });
    }
    if (line.runs.length || !lines.length) { if (!line.h) line.h = (runs[0] ? runs[0].size : 30) * this.s * lineSpacing; newLine(); }
    return lines;
  },
  // 사각형(앵커 0~1) 안에 정렬해서 그리기. visible: 보여줄 글자 수(타자기 효과)
  textBox(str, ax0, ay0, ax1, ay1, size, o = {}) {
    const g = this.g, cw = this.cw, ch = this.ch;
    const x0 = ax0 * cw, x1 = ax1 * cw, yTop = (1 - ay1) * ch, yBot = (1 - ay0) * ch;
    const runs = this.parse(str, size, o.color || '#fff');
    const lines = this.layout(runs, x1 - x0, o.lineSpacing || 1.25);
    const total = lines.reduce((a, l) => a + l.h, 0);
    let y = o.valign === 'top' ? yTop : o.valign === 'middle' ? (yTop + yBot) / 2 - total / 2 : yBot - total;
    let left = o.visible ?? 1e9;
    g.save(); g.globalAlpha = clamp01(o.alpha ?? 1); g.textBaseline = 'middle';
    for (const l of lines) {
      let x = o.align === 'left' ? x0 : o.align === 'right' ? x1 - l.w : (x0 + x1) / 2 - l.w / 2;
      for (const r of l.runs) {
        if (left <= 0) break;
        let t = r.text; if ([...t].length > left) t = [...t].slice(0, left).join('');
        left -= [...r.text].length;
        g.font = this.font(r.size, o.weight || 600);
        if (o.shadow !== false) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8 * this.s; g.fillText(t, x, y + l.h / 2); g.shadowBlur = 0; }
        g.fillStyle = o.forceColor || r.color; g.fillText(t, x, y + l.h / 2);
        x += r.w;
      }
      y += l.h;
    }
    g.restore();
    return { lines, total };
  },
  charCount(str) { return this.parse(str, 10, '#fff').reduce((a, r) => a + [...r.text.replace(/\n/g, '')].length + (r.text.match(/\n/g) || []).length, 0); },
  fill(color, alpha = 1) { if (alpha <= 0) return; const g = this.g; g.save(); g.globalAlpha = clamp01(alpha); g.fillStyle = color; g.fillRect(0, 0, this.cw, this.ch); g.restore(); },
};

// ------------------------------------------------------------------ ScreenFader
const Fader = {
  alpha: 0,
  *fade(target, duration) {
    const start = this.alpha;
    if (duration <= 0) { this.alpha = target; return; }
    for (let t = 0; t < duration;) { t += Time.udt; this.alpha = lerp(start, target, Math.min(1, t / duration)); yield; }
    this.alpha = target;
  },
  start(target, dur) { return Co.start(this.fade(target, dur), 'global'); }
};

// ------------------------------------------------------------------ LoopUI
const GLITCH = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅓㅗㅜㅡㅣ#%&*?!@/\\|~_=+<>0123456789■□';
function corrupt(text, chance) {
  if (chance <= 0) return text;
  return [...text].map(c => (c !== ' ' && Math.random() < chance) ? GLITCH[randInt(0, GLITCH.length)] : c).join('');
}
const LoopUI = {
  charsPerSecond: 22, voiceVolume: 0.55,
  queue: [], speaking: false, speechCo: null, sub: { text: '', visible: 0, alpha: 0, rect: [0.1, 0.07, 0.9, 0.3] },
  voiceHandle: null,
  blackout: 0,
  clue: null, clueAlpha: 0, clueJournal: false, clueIndex: 0, clueOpenedFrame: -1, ClueClosedFrame: -1, lineAfterClue: null, movementWasLocked: false,
  asking: null, IsAsking: false,
  prompt: { target: null, text: '', ghost: 0, timer: 0, blank: false, color: '#fff', ox: 0, oy: 0, rx: 0, cx: 0 },
  tips: [], tipRunning: false, tip: { text: '', alpha: 0 }, tabTipShown: false,
  journalMuffle: 0,
  get Dt() { return PlayerState.Paused ? 0 : Time.udt; },
  get IsSpeaking() { return this.speaking || this.queue.length > 0; },
  get IsClueOpen() { return this.clueAlpha > 0.01; },
  reset() { this.ClearSpeech(); this.clueAlpha = 0; this.clue = null; this.blackout = 0; this.prompt.target = null; },

  TipKey(key, label) { return `<color=#E8E8E8>${key}</color>  ${label}`; },
  ShowTip(text, hold = 3) { this.tips.push([text, hold]); if (!this.tipRunning) Co.start(this.tipRoutine(), 'global'); },
  *tipRoutine() {
    this.tipRunning = true;
    while (this.tips.length) {
      const [text, hold] = this.tips.shift(); this.tip.text = text;
      for (let t = 0; t < 1; t += this.Dt) { this.tip.alpha = smoothstep(0, 1, t); yield; }
      this.tip.alpha = 1; yield* this.waitReal(hold);
      for (let t = 0; t < 1; t += this.Dt) { this.tip.alpha = 1 - smoothstep(0, 1, t); yield; }
      this.tip.alpha = 0; yield* this.waitReal(0.3);
    }
    this.tipRunning = false;
  },
  *waitReal(s) { for (let t = 0; t < s; t += this.Dt) yield; },

  Say(line, hold = 2.5, speaker = null, emitter = null, gain = 1) {
    if (!line) return;
    const text = speaker ? `<size=75%><color=#b44>${speaker}</color></size>\n${line}` : line;
    this.queue.push({ text, hold, voice: Audio.voice(line), emitter, gain });
    if (!this.speechCo || this.speechCo.done) this.speechCo = Co.start(this.speechLoop(), 'global');
  },
  *WaitForSpeech() { while (this.IsSpeaking) yield; },
  ClearSpeech() {
    this.queue.length = 0; if (this.speechCo) Co.stop(this.speechCo); this.speechCo = null;
    this.speaking = false; this.sub.alpha = 0; this.stopVoice();
  },
  stopVoice() { if (this.voiceHandle) { this.voiceHandle.stop(); this.voiceHandle = null; } },
  playVoice(clip, emitter, gain = 1) {
    this.stopVoice();
    const live = emitter && (typeof emitter !== 'object' || !emitter.hidden);
    const em = live ? (() => ({ x: emitter.x, z: emitter.z })) : null;
    this.voiceHandle = Audio.play(clip, { cat: 'voice', vol: this.voiceVolume * gain, emitter: em, min: 3, max: 28 });
    return this.voiceHandle;
  },
  *speechLoop() {
    while (this.queue.length) {
      while (this.IsClueOpen && !this.clueJournal) yield;
      const s = this.queue.shift();
      this.speaking = true; this.sub.text = s.text; this.sub.visible = 0; this.sub.alpha = 1; this.sub.rect = [0.1, 0.07, 0.9, 0.3];
      const total = UI.charCount(s.text), started = Time.unscaledTime;
      let vh = null;
      if (s.voice) vh = this.playVoice(s.voice, s.emitter, s.gain);
      let t = 0;
      while (this.sub.visible < total) { this.sub.visible = Math.floor(t * this.charsPerSecond); yield; t += this.Dt; }
      this.sub.visible = total;
      let hold = s.hold;
      if (vh) { const len = Audio.duration(s.voice) || (vh.dur || 0); hold = Math.max(hold, len + 0.3 - (Time.unscaledTime - started)); }
      yield* this.waitReal(hold);
      for (let k = 0; k < 0.4; k += this.Dt) { this.sub.alpha = 1 - k / 0.4; yield; }
      this.sub.alpha = 0; this.speaking = false;
    }
    this.speechCo = null;
  },
  // 질문 + 선택지 (퀴즈맨)
  *Ask(question, choices, speaker = null, emitter = null) {
    this.ClearSpeech(); this.IsAsking = true;
    const text = speaker ? `<size=75%><color=#b44>${speaker}</color></size>\n${question}` : question;
    this.sub.text = text; this.sub.visible = 0; this.sub.alpha = 1; this.sub.rect = [0.1, 0.29, 0.9, 0.5];
    const total = UI.charCount(text), started = Time.unscaledTime;
    const clip = Audio.voice(question); let vh = null;
    if (clip) vh = this.playVoice(clip, emitter);
    let t = 0;
    while (this.sub.visible < total) { this.sub.visible = Math.floor(t * this.charsPerSecond); yield; t += this.Dt; }
    this.sub.visible = total;
    const rem = clip ? (Audio.duration(clip) || 0) - (Time.unscaledTime - started) : 0;
    yield* this.waitReal(Math.max(0.4, rem));
    const A = this.asking = { choices, selected: 0, appear: 0, items: choices.map((c, i) => ({ y: -100 - i * 52, scale: 0.82, alpha: 0 })), groupAlpha: 0 };
    for (; ;) {
      A.appear = moveTowards(A.appear, 1, this.Dt / 0.8); A.groupAlpha = smoothstep(0, 1, A.appear);
      if (A.appear > 0.5 && !PlayerState.Paused) {
        if (Input.hit('ArrowUp', 'KeyW') || Input.wheel < 0) { if (A.selected > 0) menuMove(); A.selected = Math.max(0, A.selected - 1); }
        if (Input.hit('ArrowDown', 'KeyS') || Input.wheel > 0) { if (A.selected < choices.length - 1) menuMove(); A.selected = Math.min(choices.length - 1, A.selected + 1); }
        if (A.appear >= 1 && Input.hit('KeyE', 'Enter', 'NumpadEnter', 'Space')) break;
      }
      const k = 1 - Math.exp(-7 * this.Dt);
      A.items.forEach((it, j) => {
        const n = j - A.selected; it.y = lerp(it.y, -60 - n * 52, k); it.scale = lerp(it.scale, n === 0 ? 1 : 0.82, k);
        it.alpha = lerp(it.alpha, (n === 0 ? 1 : Math.abs(n) === 1 ? 0.35 : 0.12) * A.groupAlpha, k);
      });
      yield;
    }
    menuSelect();
    for (let k = 0; k < 0.35; k += this.Dt) { const a = 1 - k / 0.35; A.groupAlpha = a; this.sub.alpha = a; yield; }
    this.asking = null; this.sub.alpha = 0; this.stopVoice(); this.sub.rect = [0.1, 0.07, 0.9, 0.3];
    this.IsAsking = false;
    return A.selected;
  },
  OpenClue(clue, afterLine = null) {
    this.clueJournal = false; this.lineAfterClue = afterLine; this.clue = clue; this.openPanel();
    play2D(SFX.clueFound);
  },
  OpenJournal() {
    if (LoopManager.FoundCount === 0) { if (!this.IsSpeaking) this.Say('...아무것도 기억나지 않는다.', 1.5); return; }
    this.clueJournal = true; this.lineAfterClue = null; this.clueIndex = LoopManager.FoundCount - 1;
    this.clue = LoopManager.foundClues[this.clueIndex]; this.openPanel();
  },
  openPanel() {
    this.clueOpenedFrame = Time.frame; this.clueAlpha = 1;
    const p = World.player; if (p) { this.movementWasLocked = p.movementLocked; p.movementLocked = true; }
  },
  ForceCloseClue() { if (this.IsClueOpen) { this.lineAfterClue = null; this.closeClue(); } },
  closeClue() {
    this.ClueClosedFrame = Time.frame; this.clueAlpha = 0;
    const p = World.player; if (p) p.movementLocked = this.movementWasLocked || PlayerState.InputLocked;
    if (this.lineAfterClue) this.Say(this.lineAfterClue);
    this.lineAfterClue = null;
    if (!this.clueJournal && !this.tabTipShown && LoopManager.FoundCount >= 1) { this.tabTipShown = true; this.ShowTip(this.TipKey('Tab', '단서 확인')); }
    JumpScare.onClueClosed(this.clueJournal);
  },
  ShowPrompt(t) { if (!t) { this.prompt.target = null; return; } if (t !== this.prompt.target) this.prompt.timer = 0; this.prompt.target = t; },
  HidePrompt() { this.prompt.target = null; },
  *SetBlackout(on, dur = 0) { const s = this.blackout; if (dur <= 0) { this.blackout = on ? 1 : 0; return; } for (let t = 0; t < dur; t += this.Dt) { this.blackout = lerp(s, on ? 1 : 0, t / dur); yield; } this.blackout = on ? 1 : 0; },

  update() {
    // 프롬프트 글리치 (기억을 잃을수록 글자가 깨진다)
    const P = this.prompt;
    if (P.target && !this.IsClueOpen && !TimeRewind.IsRewinding) {
      const ml = LoopManager.MemoryLoss; P.timer -= this.Dt;
      if (P.timer <= 0) {
        P.timer = 0.09 * rand(0.6, 1.6);
        let tx = corrupt(P.target, ml * 0.6); if (Math.random() < ml * 0.12) tx = '';
        P.text = tx; P.color = Math.random() < ml * 0.3 ? '#ffbfbf' : '#fff';
        const n = ml * 5; P.rx = -n - Math.random() * n; P.cx = n + Math.random() * n; P.ghost = ml * 0.6;
        P.ox = rand(-1, 1) * ml * 6; P.oy = rand(-1, 1) * ml * 2;
      }
    }
    // 단서 화면 조작
    if (PlayerState.Paused) return;
    if (this.IsClueOpen) {
      if (Time.frame !== this.clueOpenedFrame) {
        if (Input.hit('KeyE', 'Tab', 'Escape')) this.closeClue();
        else if (this.clueJournal && Input.hit('KeyA', 'ArrowLeft')) this.flip(-1);
        else if (this.clueJournal && Input.hit('KeyD', 'ArrowRight')) this.flip(1);
      }
    } else if (Input.hit('Tab') && !LoopFlow.Busy && Game.inGameplay()) this.OpenJournal();
    // 일지 열람 중 목소리 먹먹하게
    const target = this.IsClueOpen && this.clueJournal ? 1 : 0;
    this.journalMuffle = moveTowards(this.journalMuffle, target, Time.udt / 0.25);
    if (this.voiceHandle) { const m = smoothstep(0, 1, this.journalMuffle); this.voiceHandle.setLowpass(Math.exp(lerp(Math.log(22000), Math.log(1400), m))); }
  },
  flip(d) { const n = LoopManager.FoundCount; this.clueIndex = (this.clueIndex + d + n) % n; this.clue = LoopManager.foundClues[this.clueIndex]; },

  draw() {
    const g = UI.g, cw = UI.cw, ch = UI.ch;
    UI.fill('#000', this.blackout);
    // 단서
    if (this.IsClueOpen && this.clue) {
      UI.fill('#000', 0.82 * this.clueAlpha);
      const c = this.clue, im = Img[c.img];
      if (im) {
        const bx0 = 0.3 * cw, by0 = 0.1 * ch, bw = 0.4 * cw, bh = 0.48 * ch, r = Math.min(bw / im.width, bh / im.height);
        g.drawImage(im, bx0 + (bw - im.width * r) / 2, by0 + (bh - im.height * r) / 2, im.width * r, im.height * r);
        UI.textBox(c.title, 0.1, 0.32, 0.9, 0.4, 46);
        UI.textBox(c.desc, 0.2, 0.1, 0.8, 0.3, 32, { valign: 'top', color: '#d9d9d9' });
      } else {
        UI.textBox(c.title, 0.1, 0.55, 0.9, 0.65, 46);
        UI.textBox(c.desc, 0.2, 0.25, 0.8, 0.53, 32, { valign: 'top', color: '#d9d9d9' });
      }
      const hint = this.clueJournal ? `${this.clueIndex + 1} / ${LoopManager.FoundCount}    [A][D] 넘기기    [Tab] 닫기` : '[E] 닫기';
      UI.textBox(hint, 0.5, 0.03, 0.97, 0.1, 22, { align: 'right', alpha: 0.4, shadow: false });
    }
    // 프롬프트
    const P = this.prompt;
    if (P.target && !this.IsClueOpen && !TimeRewind.IsRewinding && P.text) {
      const s = UI.s;
      g.save(); g.translate(P.ox * s, -P.oy * s);
      if (P.ghost > 0.01) {
        g.save(); g.translate(P.rx * s, 0); UI.textBox(P.text, 0.3, 0.33, 0.7, 0.4, 34, { valign: 'middle', forceColor: `rgba(255,26,26,${P.ghost})`, shadow: false }); g.restore();
        g.save(); g.translate(P.cx * s, 0); UI.textBox(P.text, 0.3, 0.33, 0.7, 0.4, 34, { valign: 'middle', forceColor: `rgba(26,230,255,${P.ghost})`, shadow: false }); g.restore();
      }
      UI.textBox(P.text, 0.3, 0.33, 0.7, 0.4, 34, { valign: 'middle', forceColor: P.color });
      g.restore();
    }
    // 선택지
    const A = this.asking;
    if (A) {
      const x0 = 0.25 * cw, x1 = 0.75 * cw, top = (1 - 0.27) * ch;
      A.choices.forEach((c, j) => {
        const it = A.items[j], n = j - A.selected;
        g.save(); g.globalAlpha = clamp01(it.alpha); g.font = UI.font(36 * it.scale); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8 * UI.s;
        g.fillStyle = n === 0 ? 'rgb(255,242,217)' : 'rgb(204,204,204)'; g.fillText(c, (x0 + x1) / 2, top - it.y * UI.s); g.restore();
      });
      UI.textBox('↑ ↓  고르기        [E]  결정', 0.3, 0.01, 0.7, 0.05, 20, { valign: 'middle', alpha: 0.35 * A.groupAlpha, shadow: false });
    }
    // 자막
    if (this.sub.alpha > 0.001) {
      const r = this.sub.rect, a = this.sub.alpha * lerp(1, 0.45, smoothstep(0, 1, this.journalMuffle));
      UI.textBox(this.sub.text, r[0], r[1], r[2], r[3], 38, { visible: this.sub.visible, alpha: a });
    }
    // 안내
    if (this.tip.alpha > 0.001) UI.textBox(this.tip.text, 0.1, 0.015, 0.9, 0.06, 26, { valign: 'middle', alpha: this.tip.alpha, color: 'rgba(158,158,158,0.9)' });
  }
};

// ------------------------------------------------------------------ HomeMarker (집 방향 표시)
const HomeMarker = {
  timer: 0, label: '', icon: '◇', blink: false, ghost: 0, color: '#fff2d9', seed: Math.random() * 100, rx: 0, cx: 0, pos: [0, 0],
  draw(cam) {
    const tgt = World.homeEntrance;
    if (!tgt || !World.isStreet() || PlayerState.InputLocked || PlayerState.IsHidden || LoopFlow.Busy || TimeRewind.IsRewinding || LoopUI.IsClueOpen) return;
    const ml = LoopManager.MemoryLoss, t = Time.time * 0.15;
    const ox = (perlin(this.seed, t) - 0.5) * 2 * 12 * ml, oz = (perlin(t, this.seed) - 0.5) * 2 * 12 * ml;
    const wx = tgt.x + ox, wz = tgt.z + oz, wy = 1.2 + 3;
    const cw = UI.cw, ch = UI.ch, d = dist2(cam.x, cam.z, tgt.x, tgt.z);
    // 월드 → 화면
    const yaw = cam.yaw * DEG, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = wx - cam.x, dz = wz - cam.z, dep = dx * fx + dz * fz, lat = dx * rx + dz * rz;
    const tanV = Math.tan((cam.fov || 60) * DEG / 2), tanH = tanV * cw / ch;
    const pitchOff = Math.tan(cam.pitch * DEG);
    let sx, sy; const behind = dep < 0;
    const dd = Math.abs(dep) < 0.01 ? 0.01 : dep;
    sx = cw / 2 + (lat / dd) / tanH * cw / 2;
    sy = ch / 2 - ((wy - cam.y) / dd / tanV - pitchOff / tanV) * ch / 2;
    if (behind) { sx = cw - sx; sy = ch - sy; }
    const margin = 70 * UI.s;
    const off = behind || sx < margin || sx > cw - margin || sy < margin || sy > ch - margin;
    let icon = '◇';
    if (off) {
      let vx = sx - cw / 2, vy = sy - ch / 2; const L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
      const a = (cw / 2 - margin) / Math.max(1e-4, Math.abs(vx)), b = (ch / 2 - margin) / Math.max(1e-4, Math.abs(vy)), k = Math.min(a, b);
      sx = cw / 2 + vx * k; sy = ch / 2 + vy * k;
      icon = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? '→' : '←') : (vy < 0 ? '↑' : '↓');
    }
    sx += rand(-1, 1) * ml * 10 * UI.s; sy += rand(-1, 1) * ml * 4 * UI.s;
    this.timer -= Time.udt;
    if (this.timer <= 0) {
      this.timer = 0.1 * rand(0.6, 1.6);
      const c = ml * 0.6;
      this.label = corrupt(`집 - ${Math.round(d)}m`, c); this.iconTxt = Math.random() < c ? corrupt(icon, 1) : icon;
      this.ghost = ml * 0.6; const n = ml * 5; this.rx = -n - Math.random() * n; this.cx = n + Math.random() * n;
      this.color = Math.random() < ml * 0.3 ? '#ffbfbf' : '#fff2d9';
      this.blink = Math.random() < ml * 0.2;
    }
    if (this.blink) return;
    const g = UI.g, s = UI.s, alpha = lerp(0.9, 0.6, ml);
    g.save(); g.globalAlpha = alpha; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = UI.font(30); g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6 * s;
    if (this.ghost > 0.01) { g.fillStyle = `rgba(255,26,26,${this.ghost})`; g.fillText(this.label, sx + this.rx * s, sy + 22 * s); g.fillStyle = `rgba(26,230,255,${this.ghost})`; g.fillText(this.label, sx + this.cx * s, sy + 22 * s); }
    g.fillStyle = this.color; g.fillText(this.label, sx, sy + 22 * s);
    g.font = UI.font(44); g.fillText(off ? this.iconTxt || icon : (this.iconTxt === '◇' || !this.iconTxt ? '◇' : this.iconTxt), sx, sy - 22 * s);
    g.restore();
  }
};

// ------------------------------------------------------------------ 화면 효과 (되감기 / 글리치 / 점프스케어 얼굴)
const FX = {
  rewind: { on: false, alpha: 0, noiseA: 0.12, t0: 0 },
  snapshot: null, snapshotAlpha: 0,
  glitch: { on: false, until: 0, snap: null, strips: [], blocks: [], noise: 0 },
  face: { alpha: 0, scale: 1, img: null, x: 0.5, y: 0.5, tilt: 0 },
  flash: 0,
  takeSnapshot() { const c = makeCanvas(Render.canvas.width, Render.canvas.height); c.getContext('2d').drawImage(Render.canvas, 0, 0); return c; },
  draw() {
    const g = UI.g, cw = UI.cw, ch = UI.ch;
    // 점프스케어 얼굴(화면 가득)
    if (this.face.alpha > 0.01) {
      const f = this.face, im = f.img || Spr.scareFace, sz = Math.max(cw, ch) * 0.9 * f.scale;
      g.save(); g.globalAlpha = f.alpha; g.translate(cw * f.x, ch * f.y); g.rotate(f.tilt * DEG); g.drawImage(im, -sz / 2, -sz / 2, sz, sz); g.restore();
    }
    // 글리치
    const G = this.glitch;
    if (G.on && G.snap) {
      const n = 18, h = ch / n, tints = [null, 'rgba(255,64,64,0.25)', 'rgba(64,255,255,0.25)', 'rgba(0,0,0,0.5)'];
      if (G.show) for (let i = 0; i < n; i++) {
        const s = G.strips[i]; if (!s || !s.on) continue;
        g.drawImage(G.snap, s.u * G.snap.width, (i / n) * G.snap.height, G.snap.width, G.snap.height / n, s.dx * UI.s, i * h, cw, h);
        if (s.tint) { g.fillStyle = s.tint; g.fillRect(0, i * h, cw, h); }
      }
      for (const b of G.blocks) if (b.on) { g.fillStyle = b.c; g.fillRect(b.x * cw, (1 - b.y1) * ch, (b.x1 - b.x) * cw, (b.y1 - b.y) * ch); }
      Render.drawNoise(g, cw, ch, G.noise);
    }
    // 되감기 효과 (노이즈 + 하얀 띠)
    const R = this.rewind;
    if (R.alpha > 0.001) {
      g.save(); g.globalAlpha = R.alpha;
      Render.drawNoise(g, cw, ch, R.noiseA);
      const t = Time.unscaledTime;
      for (let i = 0; i < 3; i++) {
        const sp = 0.6 + i * 0.35, yy = (((t * sp + i * 0.37) % 1.2) - 0.1) * ch, hh = (6 + i * 10 + perlin(t * 3, i) * 30) * UI.s;
        g.fillStyle = `rgba(255,255,255,${0.12 + i * 0.04})`; g.fillRect(Math.sin(t * 40 + i) * 12 * UI.s, ch - yy - hh / 2, cw, hh);
      }
      g.restore();
    }
    if (this.snapshot && this.snapshotAlpha > 0.001) { g.save(); g.globalAlpha = this.snapshotAlpha; g.drawImage(this.snapshot, 0, 0, cw, ch); g.restore(); }
  },
  *glitchRoutine(duration) {
    const G = this.glitch; G.stop = false; G.snap = this.takeSnapshot(); G.on = true;
    const tints = [null, 'rgba(255,64,64,0.35)', 'rgba(64,255,255,0.35)', 'rgba(20,20,20,0.6)'];
    for (let t = 0; t < duration; t += Time.udt) {
      if (G.stop) break;
      const k = 1 - t / duration * 0.6; G.show = Math.random() < 0.65;
      G.strips = Array.from({ length: 18 }, () => ({ on: Math.random() < 0.7, u: Math.random() < 0.3 ? rand(-0.08, 0.08) : 0, dx: rand(-160, 160) * k * (Math.random() < 0.5 ? 1 : 0.15), tint: tints[randInt(0, 4)] }));
      G.blocks = Array.from({ length: 8 }, () => { const x = Math.random(), y = Math.random(); return { on: Math.random() < 0.35 * k, x, y, x1: Math.min(1, x + rand(0.05, 0.5)), y1: Math.min(1, y + rand(0.005, 0.06)), c: Math.random() < 0.5 ? '#000' : Math.random() < 0.5 ? '#ff0066' : '#fff' }; });
      G.noise = rand(0.05, 0.35) * k; Render.post.chroma = rand(0.5, 1); Render.post.contrast = 1.4; Render.post.sat = 0.7;
      if (Math.random() < 0.12) yield real(rand(0.04, 0.1)); else yield;
    }
    G.on = false; G.snap = null; Render.post.chroma = 0; Render.post.contrast = 1; Render.post.sat = 1;
  },
  Glitch(d) { Co.start(this.glitchRoutine(d), 'global'); },
  StopGlitch() { this.glitch.stop = true; }
};

// ------------------------------------------------------------------ 필름 카메라 (FilmCamera)
const FilmCamera = {
  filmPerLoop: 3, range: 28, frameArea: 0.7, cooldown: 0.9, zoomFov: 45,
  HasCamera: false, Holding: false, Film: 3, lastShot: -99, flashA: 0, targets: new Set(),
  onSubwayLoaded() { this.lower(); this.HasCamera = false; this.Film = this.filmPerLoop; },
  give() { this.HasCamera = true; this.Film = this.filmPerLoop; },
  update() {
    const blocked = PlayerState.InputLocked || PlayerState.IsHidden || TimeRewind.IsRewinding || PlayerState.Paused || LoopUI.IsClueOpen || LoopUI.IsAsking;
    if (!this.HasCamera || blocked) { if (this.Holding) this.lower(); return; }
    if (Input.hit('KeyG')) { if (this.Holding) this.lower(); else this.raise(); }
    if (this.Holding && Input.mousePressed && Time.time - this.lastShot >= this.cooldown) this.shoot();
  },
  raise() { this.Holding = true; },
  lower() { this.Holding = false; },
  shoot() {
    this.lastShot = Time.time;
    if (this.Film <= 0) { Audio.play(Proc.empty, { vol: 0.8 }); if (!LoopUI.IsSpeaking) LoopUI.Say('...필름이 없다.', 1.2); return; }
    this.Film--; Audio.play(Proc.shutter, { vol: 0.9 });
    Co.start(this.flash(), 'global');
    const cam = World.camera(); const half = (1 - this.frameArea) / 2;
    for (const t of [...this.targets]) {
      const p = t.photoPoint(); const v = World.toViewport(cam, p.x, p.y, p.z);
      if (v.z <= 0 || v.z > this.range || v.x < half || v.x > 1 - half || v.y < half || v.y > 1 - half) continue;
      if (sightClear(World.map, cam.x, cam.z, p.x, p.z)) t.onPhotographed();
    }
  },
  *flash() {
    World.flashLight = 1; this.flashA = 0.85;
    for (let t = 0; t < 0.35; t += Time.dt) { const n = 1 - t / 0.35; World.flashLight = n * n; this.flashA = 0.85 * n; yield; }
    World.flashLight = 0; this.flashA = 0;
  },
  draw() {
    const g = UI.g, cw = UI.cw, ch = UI.ch, s = UI.s;
    if (this.flashA > 0.001) UI.fill('#fff', this.flashA);
    if (!this.Holding) return;
    let na = 0.05 + Math.random() * 0.05; if (Math.random() < 0.05) na += 0.15;
    Render.drawNoise(g, cw, ch, na);
    const half = (1 - this.frameArea) / 2;
    g.save(); g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [ax, ay] of [[half, half], [1 - half, half], [half, 1 - half], [1 - half, 1 - half]]) {
      const x = ax * cw, y = (1 - ay) * ch, sx = ax < 0.5 ? 1 : -1, sy = ay < 0.5 ? -1 : 1;
      g.fillRect(sx > 0 ? x : x - 60 * s, sy > 0 ? y : y - 3 * s, 60 * s, 3 * s);
      g.fillRect(sx > 0 ? x : x - 3 * s, sy > 0 ? y : y - 60 * s, 3 * s, 60 * s);
    }
    g.textBaseline = 'middle';
    g.font = UI.font(34); g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('+', cw / 2, ch / 2);
    if (Time.time % 1 < 0.6) { g.font = UI.font(30); g.textAlign = 'left'; g.fillStyle = 'rgba(255,51,51,0.9)'; g.fillText('REC', (half + 0.02) * cw - 80 * s, (1 - (1 - half - 0.04)) * ch); }
    g.font = UI.font(26); g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(`FILM ${this.Film}/${this.filmPerLoop}`, (1 - half - 0.06) * cw + 110 * s, (1 - (half + 0.04)) * ch);
    g.restore();
  }
};
