// 메뉴: 경고 화면(WarningScreen), 타이틀(TitleMenu + LobbyBackdrop), 설정(SettingsMenu), 일시정지(PauseMenu), 로비 초기화(LobbyResetPrompt)
'use strict';

const MenuHint = { Join: (...a) => a.filter(Boolean).join('      '), Key: (k, l) => `<color=#E8E8E8>${k}</color>  ${l}`, get Move() { return this.Key('↑↓', '이동'); }, get Adjust() { return this.Key('←→', '조절'); }, get Select() { return this.Key('Enter', '선택'); }, Esc(l) { return this.Key('Esc', l); } };
function drawHint(text, alpha = 1) { if (text) UI.textBox(text, 0.05, 0.02, 0.95, 0.07, 24, { valign: 'middle', alpha: 0.6 * alpha, color: '#9e9e9e', shadow: false }); }

// ------------------------------------------------------------------ 설정 메뉴
const SettingsMenu = {
  IsOpen: false, page: 'main', index: 0, onBack: null, items: [],
  open(onBack) { this.IsOpen = true; this.page = 'main'; this.index = 0; this.onBack = onBack; this.build(); },
  pct: v => `${Math.round(v * 100)}%`,
  build() {
    const S = Settings, row = (label, value, change, desc, action) => ({ label, value, change, desc, action });
    const back = row('뒤로', null, null, null, () => this.back());
    const vol = (label, get, set, desc) => row(label, () => this.pct(get()), d => set(Math.round((get() + d * 0.1) * 10) / 10), desc);
    if (this.page === 'main') { this.title = '설정'; this.items = [row('그래픽', null, null, null, () => this.go('gfx')), row('오디오', null, null, null, () => this.go('audio')), row('조작', null, null, null, () => this.go('ctrl')), back]; }
    if (this.page === 'gfx') {
      this.title = '그래픽';
      this.items = [
        row('화면 모드', () => document.fullscreenElement ? '전체화면' : '창 모드', () => this.toggleFull(), null, () => this.toggleFull()),
        row('개씹완화 모드', () => S.MildMode ? '켜짐' : '꺼짐', () => S.MildMode = !S.MildMode, '점프스케어 요소를 제거합니다.', () => S.MildMode = !S.MildMode),
        row('밝기', () => this.pct(S.Brightness), d => S.Brightness = Math.round((S.Brightness + d * 0.1) * 10) / 10, '화면이 너무 어두우면 올려 주세요.'),
        row('그래픽 품질', () => ['낮음', '보통', '높음'][S.Quality], d => S.Quality = clamp(S.Quality + d, 0, 2), '낮출수록 가볍게 돌아갑니다.'),
        back];
    }
    if (this.page === 'audio') {
      this.title = '오디오';
      this.items = [vol('전체 음량', () => S.Volume, v => S.Volume = v), vol('효과음', () => S.SfxVolume, v => S.SfxVolume = v), vol('대사 음량', () => S.VoiceVolume, v => S.VoiceVolume = v),
      vol('환경음', () => S.AmbienceVolume, v => S.AmbienceVolume = v), vol('갑툭튀 음량', () => S.JumpScareVolume, v => S.JumpScareVolume = v, '점프스케어 소리가 많이 시끄럽습니다. 조금 줄이시는걸 추천드립니다.'), back];
    }
    if (this.page === 'ctrl') { this.title = '조작'; this.items = [row('마우스 감도', () => S.MouseSensitivity.toFixed(2), d => S.MouseSensitivity = Math.round((S.MouseSensitivity + d * 0.25) * 4) / 4), back]; }
  },
  toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); },
  go(p) { menuSelect(); this.page = p; this.index = 0; this.build(); },
  back() { menuCancel(); if (this.page !== 'main') { const from = this.page; this.page = 'main'; this.build(); this.index = { gfx: 0, audio: 1, ctrl: 2 }[from] || 0; } else { this.IsOpen = false; this.onBack && this.onBack(); } },
  hint() { const r = this.items[this.index]; return r && r.change ? MenuHint.Join(MenuHint.Move, MenuHint.Adjust, MenuHint.Select, MenuHint.Esc('뒤로')) : MenuHint.Join(MenuHint.Move, MenuHint.Select, MenuHint.Esc('뒤로')); },
  update() {
    if (!this.IsOpen) return;
    const r = this.items[this.index];
    if (Input.hit('ArrowDown', 'KeyS')) { this.index = (this.index + 1) % this.items.length; menuMove(); }
    else if (Input.hit('ArrowUp', 'KeyW')) { this.index = (this.index - 1 + this.items.length) % this.items.length; menuMove(); }
    else if (r.change && Input.hit('ArrowRight', 'KeyD')) { r.change(1); menuMove(); }
    else if (r.change && Input.hit('ArrowLeft', 'KeyA')) { r.change(-1); menuMove(); }
    else if (Input.hit('Enter', 'NumpadEnter', 'Space')) { if (r.action) r.action(); else if (r.change) { r.change(1); menuMove(); } }
    else if (Input.hit('Escape')) this.back();
  },
  draw(alpha = 1) {
    if (!this.IsOpen) return;
    const g = UI.g, cw = UI.cw, ch = UI.ch, s = UI.s;
    UI.textBox(this.title, 0.1, 0.78, 0.9, 0.88, 64, { valign: 'middle', alpha, color: '#e8e8e8' });
    const n = this.items.length, y0 = ch * 0.5 - (n - 1) * 45 * s;
    this.items.forEach((r, i) => {
      const sel = i === this.index, y = y0 + i * 90 * s;
      g.save(); g.globalAlpha = alpha * (sel ? 1 : 0.55); g.textBaseline = 'middle'; g.font = UI.font(sel ? 50 : 46);
      g.fillStyle = sel ? '#fff' : '#9e9e9e';
      if (r.value) {
        g.textAlign = 'right'; g.fillText(r.label, cw * 0.48, y);
        g.textAlign = 'left'; g.fillText(sel ? `＜   ${r.value()}   ＞` : r.value(), cw * 0.53, y);
      } else { g.textAlign = 'center'; g.fillText((sel ? '＞  ' : '') + r.label + (sel ? '  ＜' : ''), cw / 2, y); }
      g.restore();
    });
    const d = this.items[this.index] && this.items[this.index].desc;
    if (d) UI.textBox(d, 0.2, 0.1, 0.8, 0.16, 28, { valign: 'middle', alpha: alpha * 0.8, color: '#bdbdbd' });
  }
};

// ------------------------------------------------------------------ 경고 화면
const Warning = {
  shown: false, IsShowing: false, alpha: 0, closing: false,
  start() { if (this.shown) return; this.shown = true; this.IsShowing = true; this.alpha = 0; Co.start(this.fadeIn(), 'global'); },
  *fadeIn() { yield real(0.3); for (let t = 0; t < 1; t += Time.udt) { this.alpha = t; yield; } this.alpha = 1; },
  update() {
    if (!this.IsShowing || this.closing) return;
    if (this.alpha > 0.5 && Input.hit('Enter', 'NumpadEnter')) { menuConfirm(); this.closing = true; Co.start((function* () { for (let t = 0; t < 0.8; t += Time.udt) { Warning.alpha = 1 - t / 0.8; yield; } Warning.alpha = 0; Warning.IsShowing = false; })(), 'global'); }
  },
  draw() {
    if (!this.IsShowing) return;
    const g = UI.g, cw = UI.cw, ch = UI.ch, a = this.alpha;
    UI.fill('#000', a);
    g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = UI.font(96, 800); g.fillStyle = 'rgb(230,33,33)';
    if ('letterSpacing' in g) g.letterSpacing = `${0.3 * 96 * UI.s}px`;
    g.fillText('경고', cw / 2, ch * 0.34); g.restore();
    UI.textBox('이 게임에는 <color=#E52222>갑작스러운 이미지 및 공포 연출, 강한 빛의 깜빡임,\n고음 및 큰 음량의 사운드</color>가 포함되어 있습니다.', 0.1, 0.43, 0.9, 0.57, 38, { valign: 'middle', alpha: a, color: '#f0f0f0', weight: 700, lineSpacing: 1.6, shadow: false });
    UI.textBox('빛이나 소리에 민감하거나 불편함을 느끼는 경우 플레이에 주의해 주세요.', 0.1, 0.36, 0.9, 0.42, 32, { valign: 'middle', alpha: a, color: '#adadad', shadow: false });
    const pa = a * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(Time.unscaledTime * 2.4)));
    const s = UI.s, y = ch * 0.78;
    g.save(); g.globalAlpha = pa;
    if (Img.Enter_0) g.drawImage(Img.Enter_0, cw / 2 - 120 * s, y - 32 * s, 64 * s, 64 * s);
    g.font = UI.font(36); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('-  시작', cw / 2 - 40 * s, y);
    g.restore();
  }
};

// ------------------------------------------------------------------ 로비 (타이틀)
const Title = {
  items: ['시작', '설정', '종료'], index: 0, colors: [1, 0, 0], arrowY: 0, busy: false, starting: false,
  idleTime: 0, lastInput: 0, uiVis: 1, eggs: [{ time: 120, key: '#EGG_MOTHER', text: '제발... 그러지 말아주세요..' }, { time: 240, key: '#EGG_FATHER', text: '...당신이 왜 또 여기에...' }, { time: 360, key: '#EGG_GIRL', text: '앞이... 안보여요...' }],
  whisper: { text: '', alpha: 0, playing: false }, variant: 'subway', reset: { open: false, sel: 1, step: 0, quitting: false }, music: null, lyrics: { text: '', alpha: 0 },
};
function buildLobbyScene(s) {
  Time.scale = 1; World.player = null;
  const last = Settings.LastEnding;
  Title.variant = last === 2 ? 'desk' : last === 1 ? 'grave' : 'subway';
  Title.index = 0; Title.busy = false; Title.starting = false; Title.idleTime = 0; Title.lastInput = Time.unscaledTime; Title.uiVis = 1;
  for (const e of Title.eggs) e.played = false;
  Title.whisper.alpha = 0; Title.lyrics.alpha = 0; Title.reset.open = false;
  if (Title.variant === 'subway') {
    // 달리는 지하철 안 (LobbyBackdrop.subway)
    const m = buildTrain(); World.maps = { train: m }; World.map = m; World.entities = [];
    Object.assign(Train, { travel: 0, speed: 15, atStation: false, watchArrived: false });
    World.player = new Player(-7.2, -0.9, 68); World.player.eyeY = 1.25; World.player.pitch = 2; World.player.enabled = false;
  }
  Title.music = Scenes.sound(Title.variant === 'desk' ? 'lullaby' : 'Quiet_Goodbye', { cat: 'music', vol: 0.6, loop: Title.variant !== 'desk' });
  Title.musicStart = Time.unscaledTime;
  s.update = lobbyUpdate; s.draw = lobbyDraw;
  Warning.start();
  Audio.preload(['Night_city', 'Station_empty', 'Subway_door_open', 'metro_leaving', ...SFX.footsteps]);
}
function lobbyUpdate() {
  const T = Title;
  if (T.variant === 'subway') { Train.travel += 15 * Time.udt; World.player.roll = Math.sin(Time.unscaledTime * 1.3) * 0.35; World.player.eyeY = 1.25 + Math.sin(Time.unscaledTime * 7) * 0.004; }
  if (T.variant === 'desk') {
    const lyr = ['달빛이 창가에 내려앉으면', '작은 두 눈을 감으렴', '오늘의 바람도 지나가고', '밤은 너를 안아줄 거야', '조용히, 조용히', '내 품에 기대렴', '아무것도 두려워 말고', '엄마 노래를 들으렴'], times = [13, 20.5, 26, 34, 41, 47, 53, 62];
    const t = Time.unscaledTime - T.musicStart; let idx = -1; for (let i = 0; i < times.length; i++) if (t >= times[i]) idx = i;
    if (idx >= 0) { const st = times[idx], en = idx + 1 < times.length ? times[idx + 1] : st + 7 + 1.4 * 2, k = t - st; T.lyrics.text = lyr[idx]; T.lyrics.alpha = Math.min(clamp01(k / 1.4), clamp01((en - t) / 1.4)); }
  }
  if (Warning.IsShowing) { Warning.update(); T.lastInput = Time.unscaledTime; return; }
  if (T.reset.open) { resetPromptUpdate(); T.lastInput = Time.unscaledTime; return; }
  resetSequence();
  // 입력이 없으면 60초 뒤 메뉴가 사라진다
  const any = Input.anyPressed || Input.mouseDX || Input.mouseDY;
  if (any || T.starting || T.busy || SettingsMenu.IsOpen) { const wasHidden = T.uiVis < 0.95; T.lastInput = Time.unscaledTime; T.uiVis = 1; if (any && wasHidden) return; }
  else if (Time.unscaledTime - T.lastInput >= 60) T.uiVis = moveTowards(T.uiVis, 0, Time.udt / 2.5);
  T.idleTime += Time.udt;
  if (T.variant === 'subway') for (const e of T.eggs) if (!e.played && T.idleTime >= e.time && !T.whisper.playing) { e.played = true; Co.start(whisperRoutine(e), 'scene'); break; }
  if (SettingsMenu.IsOpen) { SettingsMenu.update(); return; }
  if (T.busy) return;
  if (Input.hit('ArrowDown', 'KeyS')) { T.index = (T.index + 1) % 3; menuMove(); }
  else if (Input.hit('ArrowUp', 'KeyW')) { T.index = (T.index + 2) % 3; menuMove(); }
  else if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyE')) {
    menuConfirm();
    if (T.index === 0) Co.start(startGame(), 'flow');
    else if (T.index === 1) SettingsMenu.open(() => { T.index = 1; });
    else { T.busy = true; Co.start((function* () { yield* Fader.fade(1, 1); T.quitMsg = true; })(), 'scene'); }
  }
  const k = 1 - Math.exp(-10 * Time.udt);
  T.colors = T.colors.map((c, i) => lerp(c, i === T.index ? 1 : 0, k));
  T.arrowY = lerp(T.arrowY, T.index, k * 1.4);
}
function* startGame() {
  Title.busy = true; Title.starting = true;
  yield* Fader.fade(1, 1.2);
  if (Title.whisperHandle) Title.whisperHandle.stop();
  yield real(1.5);
  const q = new URLSearchParams(location.search); if (q.get('loop')) LoopManager.DebugSetLoop(+q.get('loop'));
  Scenes.load('OutSide');
  yield real(1.5);
}
function* whisperRoutine(e) {
  const T = Title; T.whisper.playing = true;
  const clip = Audio.voice(e.key);
  const st = clip ? Audio.playStretched(clip, 2.6, 0.4, { cat: 'voice', vol: 0.45, rate: 0.94, lowpass: 1500 }) : null;
  T.whisperHandle = st;
  const hiss = Scenes.sound(SFX.rewindStatic, { cat: 'ambience', loop: true, vol: 0 });
  const total = st ? st.total / 0.94 : 3, head = st ? st.head / 0.94 : 1.5;
  for (let t = 0; t < total; t += Time.udt) {
    const a = clamp01(t / 0.8), b = clamp01((t - head) / Math.max(0.1, total - head));
    T.whisper.text = e.text; T.whisper.alpha = a * (Math.random() < b * 0.25 ? 0.2 : 1) * (0.45 + 0.15 * perlin(t * 9));
    hiss.setVol(a * (0.05 + b * 0.06)); yield;
  }
  if (st) st.stop(); hiss.stop(); T.whisper.alpha = 0;
  playLoud('glitch', 1); playLoud('glitch', 1);
  T.whisper.playing = false;
}
// Ctrl + Alt + 9 → 3 → 0 : 로비 데이터 초기화 창
function resetSequence() {
  const R = Title.reset, seq = ['Digit9', 'Digit3', 'Digit0'];
  if (!((Input.key('ControlLeft') || Input.key('ControlRight')) && (Input.key('AltLeft') || Input.key('AltRight')))) { R.step = 0; return; }
  const d = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].find(k => Input.pressed.has(k));
  if (!d) return;
  if (d === seq[R.step]) R.step++; else R.step = d === seq[0] ? 1 : 0;
  if (R.step >= 3) { R.step = 0; if (!Warning.IsShowing && Fader.alpha < 0.01 && !SettingsMenu.IsOpen) { R.open = true; R.sel = 1; menuSelect(); } }
}
function resetPromptUpdate() {
  const R = Title.reset; if (R.quitting) return;
  if (Input.hit('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD')) { R.sel = 1 - R.sel; menuMove(); }
  else if (Input.hit('Escape')) { R.open = false; menuCancel(); }
  else if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyE')) {
    if (R.sel === 1) { R.open = false; menuCancel(); return; }
    menuConfirm(); R.quitting = true; Settings.LastEnding = 0; try { localStorage.removeItem('DJ_LastEnding'); } catch (e) { }
    Co.start((function* () { yield* Fader.fade(1, 1.6); location.reload(); })(), 'global');
  }
}
function lobbyDraw() {
  const g = UI.g, cw = UI.cw, ch = UI.ch, T = Title, s = UI.s;
  if (T.variant === 'grave') drawGrave(g, cw, ch);
  else if (T.variant === 'desk') drawDesk(g, cw, ch);
  // 메뉴 뒤 어둠 (왼쪽 42%)
  const sh = g.createLinearGradient(0, 0, cw * 0.42, 0); sh.addColorStop(0, 'rgba(0,0,0,0.7)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(0, 0, cw * 0.42, ch);
  if (T.variant === 'desk' && T.lyrics.alpha > 0.01) UI.textBox(T.lyrics.text, 0.45, 0.12, 0.95, 0.2, 40, { valign: 'middle', alpha: T.lyrics.alpha * 0.85, color: '#e8dccb', weight: 400 });
  const vis = T.uiVis;
  if (!SettingsMenu.IsOpen) {
    if (Img.logo) { const h = ch * 0.5, w = h * Img.logo.width / Img.logo.height; g.save(); g.globalAlpha = vis * 0.95; g.drawImage(Img.logo, cw * 0.1 - w * 0.25, ch * 0.04, w, h); g.restore(); }
    const x = cw * 0.1, y0 = ch * 0.62;
    T.items.forEach((it, i) => {
      const c = T.colors[i], sc = lerp(0.92, 1.08, c);
      g.save(); g.globalAlpha = vis * lerp(0.55, 1, c); g.font = UI.font(62 * sc, 500); g.textBaseline = 'middle'; g.textAlign = 'left';
      if ('letterSpacing' in g) g.letterSpacing = `${0.42 * 62 * sc * s}px`;
      g.fillStyle = `rgb(${lerp(158, 255, c)},${lerp(158, 255, c)},${lerp(158, 255, c)})`; g.fillText(it, x, y0 + i * 95 * s); g.restore();
    });
    g.save(); g.globalAlpha = vis; g.font = UI.font(40); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillText('▶', x - 52 * s + 34 * s, y0 + T.arrowY * 95 * s); g.restore();
    if (!T.starting && T.whisper.alpha < 0.01) drawHint(MenuHint.Join(MenuHint.Move, MenuHint.Select), vis);
  } else { UI.fill('#000', 0.55); SettingsMenu.draw(); drawHint(SettingsMenu.hint()); }
  if (T.whisper.alpha > 0.01) UI.textBox(T.whisper.text, 0.3, 0.45, 0.7, 0.55, 34, { valign: 'middle', alpha: T.whisper.alpha, color: '#d8d8d8', weight: 400 });
  if (T.quitMsg) UI.textBox('브라우저 탭을 닫으면 게임이 종료됩니다.', 0.1, 0.45, 0.9, 0.55, 32, { valign: 'middle', color: '#888', shadow: false });
  if (T.reset.open) {
    UI.fill('#000', 0.8);
    UI.textBox('경고', 0.1, 0.62, 0.9, 0.72, 72, { valign: 'middle', color: 'rgb(230,33,33)', weight: 800 });
    UI.textBox('로비 데이터를 초기화 하시겠습니까?', 0.1, 0.5, 0.9, 0.58, 40, { valign: 'middle', color: '#eee' });
    UI.textBox('엔딩을 다시 보면 해당 로비를 다시 볼 수 있습니다.', 0.1, 0.44, 0.9, 0.5, 28, { valign: 'middle', color: '#999' });
    UI.textBox((T.reset.sel === 0 ? '▶  ' : '') + '예', 0.3, 0.32, 0.48, 0.4, 44, { valign: 'middle', color: T.reset.sel === 0 ? '#fff' : '#777' });
    UI.textBox((T.reset.sel === 1 ? '▶  ' : '') + '아니오', 0.52, 0.32, 0.7, 0.4, 44, { valign: 'middle', color: T.reset.sel === 1 ? '#fff' : '#777' });
    drawHint('←/→  선택      Enter  확인      Esc  취소');
  }
  Warning.draw();
}
// 엔딩 1 로비: 묘지 / 엔딩 2 로비: 책상 (원본은 3D 배경. 그림으로 대체)
function drawGrave(g, cw, ch) {
  const sky = g.createLinearGradient(0, 0, 0, ch); sky.addColorStop(0, '#05060a'); sky.addColorStop(0.6, '#10131a'); sky.addColorStop(1, '#07080a');
  g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
  g.fillStyle = 'rgba(200,210,230,0.8)'; g.beginPath(); g.arc(cw * 0.78, ch * 0.18, ch * 0.05, 0, 7); g.fill();
  g.fillStyle = '#0b0c0e'; g.fillRect(0, ch * 0.7, cw, ch * 0.3);
  const t = Time.unscaledTime;
  for (let i = 0; i < 9; i++) {
    const x = cw * (0.35 + i * 0.08 + (i % 2) * 0.02), y = ch * (0.66 + (i % 3) * 0.04), w = ch * (0.07 + (i % 2) * 0.02), h = w * 1.4;
    g.fillStyle = `rgb(${28 + i * 2},${30 + i * 2},${34 + i * 2})`; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w * 0.4); g.arc(x + w / 2, y + w * 0.4, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.fill();
  }
  g.fillStyle = '#1c1d20'; g.fillRect(cw * 0.6, ch * 0.55, ch * 0.12, ch * 0.22);
  g.fillStyle = '#aa2a2a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(cw * 0.6 + ch * (0.02 + i * 0.02), ch * 0.78, ch * 0.008, 0, 7); g.fill(); }
  for (let i = 0; i < 3; i++) { const fx = (t * 0.02 * (i + 1) + i * 0.3) % 1.4 - 0.2; const fg = g.createRadialGradient(cw * fx, ch * 0.75, 0, cw * fx, ch * 0.75, cw * 0.4); fg.addColorStop(0, 'rgba(120,130,150,0.08)'); fg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fg; g.fillRect(0, 0, cw, ch); }
}
function drawDesk(g, cw, ch) {
  g.fillStyle = '#060504'; g.fillRect(0, 0, cw, ch);
  const lx = cw * 0.68, ly = ch * 0.35, flick = 0.95 + perlin(Time.unscaledTime * 3) * 0.08;
  const r = g.createRadialGradient(lx, ly + ch * 0.25, 10, lx, ly + ch * 0.25, cw * 0.5); r.addColorStop(0, `rgba(255,190,110,${0.35 * flick})`); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#2a1a10'; g.fillRect(cw * 0.3, ch * 0.66, cw * 0.7, ch * 0.34);
  g.fillStyle = '#3a2618'; g.fillRect(cw * 0.3, ch * 0.64, cw * 0.7, ch * 0.03);
  g.fillStyle = '#151515'; g.fillRect(lx - 4, ly, 8, ch * 0.3); g.beginPath(); g.moveTo(lx - ch * 0.08, ly + 10); g.lineTo(lx + ch * 0.08, ly + 10); g.lineTo(lx + ch * 0.04, ly - ch * 0.06); g.lineTo(lx - ch * 0.04, ly - ch * 0.06); g.fill();
  if (Img.HideandSeekart) { const w = cw * 0.17, h = w * Img.HideandSeekart.height / Img.HideandSeekart.width; g.save(); g.globalAlpha = 0.85; g.translate(cw * 0.5, ch * 0.74); g.rotate(-0.08); g.drawImage(Img.HideandSeekart, -w / 2, -h / 2, w, h); g.restore(); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, cw, ch);
}

// ------------------------------------------------------------------ 일시정지
const Pause = {
  open: false, index: 0, items: ['계속하기', '설정', '종료'], busy: false,
  canPause() {
    const s = Scenes.current; if (!s || (s.name !== 'OutSide' && s.name !== 'Home')) return false;
    if (TimeRewind.IsRewinding || LoopFlow.Busy || LoopFlow.EndingPlaying) return false;
    if (LoopUI.IsClueOpen || LoopUI.ClueClosedFrame === Time.frame) return false;
    return true;
  },
  Open() { this.open = true; this.index = 0; PlayerState.Paused = true; Time.scale = 0; menuSelect(); if (document.exitPointerLock) document.exitPointerLock(); },
  Close() { this.open = false; PlayerState.Paused = false; Time.scale = 1; menuCancel(); Game.lockPointer(); },
  update() {
    if (!this.open) { if (Input.hit('Escape') && this.canPause()) this.Open(); return; }
    if (SettingsMenu.IsOpen) { SettingsMenu.update(); return; }
    if (this.busy) return;
    if (Input.hit('Escape')) this.Close();
    else if (Input.hit('ArrowDown', 'KeyS')) { this.index = (this.index + 1) % 3; menuMove(); }
    else if (Input.hit('ArrowUp', 'KeyW')) { this.index = (this.index + 2) % 3; menuMove(); }
    else if (Input.hit('Enter', 'NumpadEnter', 'Space')) {
      if (this.index === 0) this.Close();
      else if (this.index === 1) { menuSelect(); SettingsMenu.open(() => { this.index = 1; }); }
      else { menuConfirm(); this.busy = true; Co.start(this.quit(), 'global'); }
    }
  },
  *quit() { yield* Fader.fade(1, 0.8); this.open = false; this.busy = false; PlayerState.Paused = false; Time.scale = 1; LoopFlow.ReturnToLobby(); },
  draw() {
    if (!this.open) return;
    UI.fill('#000', 0.7);
    if (SettingsMenu.IsOpen) { SettingsMenu.draw(); drawHint(SettingsMenu.hint()); return; }
    const g = UI.g, cw = UI.cw, ch = UI.ch, s = UI.s;
    this.items.forEach((it, i) => {
      const sel = i === this.index; g.save(); g.globalAlpha = sel ? 1 : 0.55; g.font = UI.font(58 * (sel ? 1.06 : 0.94)); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = sel ? '#fff' : '#9e9e9e'; g.fillText(sel ? `＞  ${it}  ＜` : it, cw / 2, ch / 2 + (i - 1) * 100 * s); g.restore();
    });
    drawHint(MenuHint.Join(MenuHint.Move, MenuHint.Select, MenuHint.Esc('계속하기')));
  }
};
