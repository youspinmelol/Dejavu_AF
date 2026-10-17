// De javu (데자뷰) - HTML5 Canvas 포팅
// 코어: 시간, 코루틴(Unity StartCoroutine 대응), 입력, 설정, 루프 상태
'use strict';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpC = (a, b, t) => a + (b - a) * clamp01(t);
const smoothstep = (a, b, t) => { t = clamp01(t); t = t * t * (3 - 2 * t); return a + (b - a) * t; };
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a)); // [a,b)
const DEG = Math.PI / 180;
const moveTowards = (c, t, d) => Math.abs(t - c) <= d ? t : c + Math.sign(t - c) * d;
function deltaAngle(a, b) { let d = ((b - a) % 360 + 540) % 360 - 180; return d; }
function lerpAngle(a, b, t) { return a + deltaAngle(a, b) * clamp01(t); }
function yawTo(fx, fz, tx, tz) { return Math.atan2(tx - fx, tz - fz) / DEG; }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
// Perlin 대체(부드러운 1D/2D 값 노이즈)
function hash2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
const perlin = (x, y = 0) => vnoise(x, y);

// ---------------------------------------------------------------- 시간
const Time = { time: 0, dt: 0, unscaledTime: 0, udt: 0, scale: 1, frame: 0 };

// ---------------------------------------------------------------- 코루틴
// yield 규칙:  yield        → 다음 프레임
//              yield 1.5    → 1.5초 (Time.scale 적용, WaitForSeconds)
//              yield real(1)→ 실제 시간 1초 (WaitForSecondsRealtime)
//              yield until(fn) → fn()이 true가 될 때까지
//              중첩 코루틴은 yield* 로 호출
const real = s => ({ real: s });
const until = fn => ({ until: fn });
class Coroutine {
  constructor(gen, tag) { this.gen = gen; this.tag = tag; this.wait = null; this.done = false; }
}
const Co = {
  list: [],
  start(gen, tag = 'scene') { const c = new Coroutine(gen, tag); this.list.push(c); this.step(c); return c; },
  stop(c) { if (c) c.done = true; },
  stopTag(tag) { for (const c of this.list) if (c.tag === tag) c.done = true; },
  step(c) {
    while (!c.done) {
      const w = c.wait;
      if (w) {
        if (w.kind === 's') { w.left -= Time.dt; if (w.left > 0) return; }
        else if (w.kind === 'r') { w.left -= Time.udt; if (w.left > 0) return; }
        else if (w.kind === 'u') { if (!w.fn()) return; }
        else if (w.kind === 'f') { if (w.frame === Time.frame) return; }
        c.wait = null;
      }
      let r;
      try { r = c.gen.next(); } catch (e) { console.error(e); c.done = true; return; }
      if (r.done) { c.done = true; return; }
      const v = r.value;
      if (v === undefined || v === null) { c.wait = { kind: 'f', frame: Time.frame }; return; }
      if (typeof v === 'number') { c.wait = { kind: 's', left: v }; if (v <= 0) c.wait = { kind: 'f', frame: Time.frame }; }
      else if (v.real !== undefined) c.wait = { kind: 'r', left: v.real };
      else if (v.until) c.wait = { kind: 'u', fn: v.until };
      else c.wait = { kind: 'f', frame: Time.frame };
    }
  },
  update() {
    const l = this.list;
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (!c.done) this.step(c); }
    this.list = l.filter(c => !c.done);
  }
};
function* waitCo(c) { while (c && !c.done) yield; }

// ---------------------------------------------------------------- 입력
const Input = {
  down: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0,
  mouseDown: false, mousePressed: false, anyPressed: false, locked: false,
  init(canvas) {
    const block = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);
    addEventListener('keydown', e => {
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat) { this.pressed.add(e.code); this.anyPressed = true; }
      this.down.add(e.code);
      Audio.unlock();
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', e => {
      Audio.unlock();
      if (e.button === 0) { this.mouseDown = true; this.mousePressed = true; }
      this.anyPressed = true;
      if (Game.wantsPointerLock() && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement === canvas) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) Game.onPointerUnlock();
    });
  },
  key(c) { return this.down.has(c); },
  hit(...codes) { for (const c of codes) if (this.pressed.has(c)) return true; return false; },
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.mousePressed = false; this.anyPressed = false; }
};

// ---------------------------------------------------------------- 설정 (GameSettings / PlayerPrefs → localStorage)
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
const Settings = {
  get Volume() { return lsGet('DJ_Volume', 1); }, set Volume(v) { lsSet('DJ_Volume', clamp(v, 0, 1)); Audio.applyVolumes(); },
  get SfxVolume() { return lsGet('DJ_Sfx', 1); }, set SfxVolume(v) { lsSet('DJ_Sfx', clamp(v, 0, 1)); Audio.applyVolumes(); },
  get VoiceVolume() { return lsGet('DJ_Voice', 1); }, set VoiceVolume(v) { lsSet('DJ_Voice', clamp(v, 0, 1)); Audio.applyVolumes(); },
  get AmbienceVolume() { return lsGet('DJ_Amb', 1); }, set AmbienceVolume(v) { lsSet('DJ_Amb', clamp(v, 0, 1)); Audio.applyVolumes(); },
  get JumpScareVolume() { return lsGet('DJ_Scare', 1); }, set JumpScareVolume(v) { lsSet('DJ_Scare', clamp(v, 0, 1)); Audio.applyVolumes(); },
  get MouseSensitivity() { return lsGet('DJ_Sens', 2); }, set MouseSensitivity(v) { lsSet('DJ_Sens', clamp(v, 0.5, 5)); },
  get MildMode() { return lsGet('DJ_MildMode', false); }, set MildMode(v) { lsSet('DJ_MildMode', !!v); },
  get Brightness() { return lsGet('DJ_Brightness', 1); }, set Brightness(v) { lsSet('DJ_Brightness', clamp(v, 0.5, 1.5)); },
  get Quality() { return lsGet('DJ_Quality', 2); }, set Quality(v) { lsSet('DJ_Quality', clamp(v, 0, 2)); Render.applyQuality(); },
  get LastEnding() { return lsGet('DJ_LastEnding', 0); }, set LastEnding(v) { lsSet('DJ_LastEnding', v); },
};

// ---------------------------------------------------------------- PlayerState
const PlayerState = { IsHidden: false, InputLocked: false, Paused: false, Reset() { this.IsHidden = false; this.InputLocked = false; } };

// ---------------------------------------------------------------- LoopConfig (Resources/LoopConfig.asset 값)
const LoopConfig = {
  maxLoop: 9, totalClues: 9, rewindSpeaker: '???',
  rewindLines: [
    ['Sister', '아저씨... 우리 집에 왜 왔어?'], ['Father', '문을 열어 준 건... 나였지.'], ['Mother', '그 카메라... 치워 줘.'],
    ['Sister', '아저씨가 내 눈 가져갔지?'], ['Father', '내 머리는... 어디에 두고 갔나.'], ['Mother', '셔터 소리가... 아직도 들려.'],
    ['Sister', '이번엔 아저씨가 숨을 차례야.'], ['Father', '기억해 낼 때까지... 넌 그날에서 못 나가.'], ['Mother', '이제... 네 차례야.']
  ],
  getRewindLine(loop) { const i = loop - 1; return (i >= 0 && i < this.rewindLines.length) ? this.rewindLines[i][1] : null; }
};

// ---------------------------------------------------------------- LoopManager
const LoopManager = {
  CurrentLoop: 1, foundClues: [], foundIds: new Set(),
  TruthEndingPending: false, LostEndingPending: false, onClueFound: null,
  get MaxLoop() { return LoopConfig.maxLoop; },
  get TotalClues() { return LoopConfig.totalClues; },
  get FoundCount() { return this.foundClues.length; },
  get AllCluesFound() { return this.foundClues.length >= this.TotalClues; },
  get IsFinalLoop() { return this.CurrentLoop >= this.MaxLoop; },
  get MemoryLoss() { return this.MaxLoop > 1 ? (this.CurrentLoop - 1) / (this.MaxLoop - 1) : 1; },
  get EndingPending() { return this.TruthEndingPending || this.LostEndingPending; },
  HasClue(id) { return this.foundIds.has(id); },
  AddClue(c) {
    if (!c || !c.id || this.foundIds.has(c.id)) return false;
    this.foundIds.add(c.id); this.foundClues.push(c); return true;
  },
  NextLoop() { this.CurrentLoop = Math.min(this.CurrentLoop + 1, this.MaxLoop); },
  Reset() {
    this.CurrentLoop = 1; this.TruthEndingPending = false; this.LostEndingPending = false;
    this.foundClues = []; this.foundIds = new Set(); TimeRewind.clearRecording();
  },
  // 디버그용 (원본에도 있는 DebugSetLoop - 원본은 키에 연결돼 있지 않음. 포팅판은 URL ?loop=N 으로 사용)
  DebugSetLoop(n) { this.CurrentLoop = clamp(n | 0, 1, this.MaxLoop); this.TruthEndingPending = false; this.LostEndingPending = false; }
};

// ---------------------------------------------------------------- 공용 데이터: 단서 (씬에 직렬화된 ClueItem 값 그대로)
const CLUES = {
  street: [
    { go: 'Clue_sister_hairpin', x: 39.71, z: -85.02, minLoop: 5, img: 'Strawberry_hairpin', id: 'sister_hairpin', title: '딸기 머리핀', desc: '작은 딸기 모양 머리핀.\n손잡이에 검붉은 자국이 굳어 있다.', after: '...왜 손이 떨리지.' },
    { go: 'Clue_sister_drawing', x: 87.01, z: -99.57, minLoop: 2, img: 'HideandSeekart', id: 'sister_drawing', title: '크레파스 그림', desc: '크레파스로 그린 가족 그림.\n"아빠, 엄마, 나. 숨바꼭질! 내가 술래!"\n구석에 모르는 아저씨가 그려져 있다.', after: '...그냥 애들 낙서야.' },
    { go: 'Clue_mother_film', x: 21.57, z: -85.58, minLoop: 6, img: 'flim_tape', id: 'mother_film', title: '필름 통', desc: '현상하지 않은 필름.\n라벨에 내 글씨로 날짜가 빼곡하다.\n석 달 전부터... 마지막은 그녀가 떠나기 전날.', after: '...내 거 아니야.' },
    { go: 'Clue_mother_note', x: -14.22, z: -91.89, minLoop: 9, img: 'memo_paper', id: 'mother_note', title: '떨리는 글씨의 메모', desc: '떨리는 글씨.\n"경찰은 증거가 없대.. 오늘도 그 사람이 나에게 협박을 했어..\n자꾸 숨이 막혀."', after: '...모르는 사람 글씨야.' },
    { go: 'Clue_father_notebook', x: 57.65, z: -86.81, minLoop: 4, img: 'Quiz_book', id: 'father_notebook', title: '퀴즈 공책', desc: '어느 아버지가 딸에게 내던 퀴즈 공책.\n마지막 장에만 다른 글씨로 한 문제가 적혀 있다.\n"그날 밤 우리 집에 온 손님은 누구였지?"', after: '...남의 집 공책이야. 내가 알 리가 없잖아.' },
    { go: 'Clue_father_newspaper', x: 6.35, z: -87.58, minLoop: 7, img: 'news_paper', id: 'father_newspaper', title: '신문 조각', desc: '"○○동 30대 주부 자택서 숨진 채 발견…\n유족 \'석 달째 누군가 몰래 사진을 찍어 왔다\'"\n2주 지난 신문이다. 뒷면에 누군가 눌러 쓴 글씨가 있다.\n"경찰은 이번에도, 둘 다 넘어가라고 했다."', after: '...남의 일이야.' },
    { go: 'Clue_sister_buttons', x: 75.62, z: -92.08, minLoop: 3, img: 'doll_button', id: 'sister_buttons', title: '인형 눈 단추', desc: '토끼 인형 얼굴에서 뜯겨 나간 단추 두 개.\n누가 눈에 끼고 있다가 떨어뜨린 것처럼, 아직 따뜻하다.', after: '...꼭 눈 같... 아니, 그냥 단추야.' },
  ],
  home: [
    { go: 'FamilyPhoto', x: -0.65, z: 2.71, y: 0.61, minLoop: 1, img: 'parent_frame', id: 'family_photo', title: '액자 속 가족 그림', desc: '크레파스로 그린 가족 그림이 든 액자.\n아빠, 엄마, 어린 딸이 웃고 있다.\n모르는 가족인데... 왜 이게 내 방에 있지?', after: '...모르는 사람들이야. 누가 두고 갔겠지.', notice: 0 },
    { go: 'Clue_Receipt', x: 2.06, z: 1.1, y: 0.7, minLoop: 8, img: 'receipt', id: 'hardware_receipt', title: '철물점 영수증', desc: '사건 당일 저녁. 현금으로 샀다.\n품목 칸만 찢겨 있고, 종이에서 술 냄새가 난다.', after: '...별거 아니었겠지.', notice: 0 },
  ]
};
