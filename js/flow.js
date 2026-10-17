// 흐름: 씬 로드, LoopFlow(잠/기절/귀가), TimeRewind(되감기), OpeningCutscene(지하철), LostEndingDirector, EndingDirector
'use strict';

const PERSIST = new Set(['global', 'flow']);
const Scenes = {
  current: null,
  unload() {
    for (const c of Co.list) if (!PERSIST.has(c.tag)) c.done = true;
    const s = this.current;
    if (s && s.sounds) for (const h of s.sounds) h.stop();
    for (const h of [...Audio.handles]) if (h.sceneOwned) h.stop();
    LoopUI.HidePrompt(); LoopUI.ForceCloseClue();
    FX.face.alpha = 0; Object.assign(Render.post, { roll: 0, shakeX: 0, shakeY: 0, flash: 0, darkness: 0 });
    Hiding.all = []; Hiding.onHid = []; Hiding.Occupied = null;
    SeekGirl.instance = null; SeekGirl.BlocksHome = false; QuizMan.HomeBlocked = false; QuizMan.Active = false; PhotophobiaGhost.EncounterActive = false;
    FilmCamera.targets.clear(); JumpScare.alley = null;
    World.entities = []; World.player = null; World.homeEntrance = null; World.map = null;
  },
  load(name, opts = {}) {
    this.unload();
    const s = { name, entities: [], extraSprites: [], sounds: [], recordable: name === 'OutSide' || name === 'Home', opts };
    this.current = s;
    ({ Lobby: buildLobbyScene, OutSide: buildOutside, Home: buildHomeScene, Ending: buildEndingScene })[name](s, opts);
    if (name === 'OutSide' && !TimeRewind.IsRewinding) FilmCamera.onSubwayLoaded();
    return s;
  },
  sound(name, o) { const h = Audio.play(name, o); if (h) { h.sceneOwned = true; this.current && this.current.sounds.push(h); } return h; }
};

function lockPlayer() { if (World.player) World.player.movementLocked = true; }

// ================================================================== LoopFlow
const LoopFlow = {
  Busy: false, EndingPlaying: false,
  PassOut() { if (!this.Busy && !TimeRewind.IsRewinding) Co.start(this.sleepRoutine(1), 'flow'); },
  EnterHome() { if (!this.Busy) Co.start(this.loadRoutine('Home'), 'flow'); },
  Sleep() { if (!this.Busy) Co.start(this.sleepRoutine(), 'flow'); },
  *sleepRoutine(closeEyes = 2) {
    this.Busy = true; lockPlayer();
    yield* Fader.fade(1, closeEyes);
    yield real(0.8);
    const lost = LoopManager.IsFinalLoop && LoopManager.AllCluesFound;
    const truth = LoopManager.IsFinalLoop && !lost;
    yield* TimeRewind.rewind();
    if (truth) { LoopManager.TruthEndingPending = true; this.EndingPlaying = true; }
    else if (lost) { LoopManager.LostEndingPending = true; this.EndingPlaying = true; }
    LoopManager.NextLoop();
    if (TimeRewind.HandoffPending) yield* this.seamlessLoad('OutSide');
    else yield* this.loadRoutine('OutSide', 2);
  },
  *seamlessLoad(name) {
    this.Busy = true; Time.scale = 1; PlayerState.Reset();
    Scenes.load(name); yield; yield;
    yield* TimeRewind.releaseSnapshot(0.25);
    this.Busy = LoopManager.EndingPending;
  },
  LoadTruthEnding() { this.LoadEndingScene(false); },
  LoadEndingScene(lost) { Ending.LostVariant = lost; Co.stopTag('flow'); Co.start(this.truthEndingRoutine(), 'flow'); },
  *truthEndingRoutine() {
    this.Busy = true; this.EndingPlaying = true; LoopUI.ClearSpeech();
    yield* Fader.fade(1, 0); Time.scale = 1; PlayerState.Reset(); PlayerState.InputLocked = true;
    Scenes.load('Ending');
  },
  ReturnToLobby() {
    Co.stopTag('flow'); LoopUI.ClearSpeech(); LoopManager.Reset(); PlayerState.Reset();
    this.EndingPlaying = false; this.Busy = false; Time.scale = 1;
    Scenes.load('Lobby'); Fader.start(0, 0.8);
  },
  *loadRoutine(name, fadeTime = 1) {
    this.Busy = true; lockPlayer();
    if (Fader.alpha < 0.99) yield* Fader.fade(1, fadeTime);
    Time.scale = 1; PlayerState.Reset();
    Scenes.load(name);
    yield real(0.3);
    yield* Fader.fade(0, fadeTime);
    this.Busy = false;
  }
};

// ================================================================== TimeRewind
const TimeRewind = {
  frames: [], IsRewinding: false, HandoffPending: false, sampleTimer: 0, interval: 0.1, speedMul: 12, minDur: 6, maxDur: 12,
  tape: null,
  clearRecording() { this.frames = []; },
  update() {
    const s = Scenes.current;
    if (this.IsRewinding || Time.scale <= 0 || PlayerState.Paused || LoopFlow.Busy || LoopFlow.EndingPlaying || !s || !s.recordable || !World.player) return;
    this.sampleTimer -= Time.dt;
    if (this.sampleTimer > 0) return;
    this.sampleTimer = this.interval; this.frames.push(this.capture());
  },
  capture() {
    const p = World.player, objs = {};
    for (const e of World.entities) if (e.id) objs[e.id] = e.track ? e.track() : { x: e.x, z: e.z, active: e.active !== false };
    return { scene: Scenes.current.name, map: World.map.name, x: p.x, z: p.z, eye: p.eyeY, yaw: p.yaw, pitch: p.pitch, objs };
  },
  restartRecording() { this.frames = []; if (World.player) this.frames.push(this.capture()); this.sampleTimer = this.interval; },
  preparePlayer(sceneName) {
    const s = Scenes.current; if (!s || s.name !== sceneName || !World.player) return;
    World.player.movementLocked = true; PlayerState.InputLocked = true;
  },
  apply(a, b, t) {
    const p = World.player; if (!p) return;
    if (a.map !== World.map.name && World.maps[a.map]) setActiveMap(a.map);
    p.x = lerp(a.x, b.x, t); p.z = lerp(a.z, b.z, t); p.eyeY = lerp(a.eye, b.eye, t);
    p.yaw = lerpAngle(a.yaw, b.yaw, t); p.pitch = lerp(a.pitch, b.pitch, t);
    for (const e of Scenes.current.entities) {
      const st = e.id && a.objs[e.id]; if (!st) continue;
      if (e.applyTrack) e.applyTrack(st); else { e.x = st.x; e.z = st.z; e.active = st.active; }
    }
  },
  effects(on) {
    FX.rewind.alpha = on ? 1 : 0;
    Object.assign(Render.post, on ? { sat: 0.3, contrast: 1.25, tint: [0.85, 0.95, 1.1], chroma: 1 } : { sat: 1, contrast: 1, tint: [1, 1, 1], chroma: 0 });
  },
  animate(u) {
    FX.rewind.noiseA = moveTowards(FX.rewind.noiseA, 0.1 + Math.random() * 0.06, Time.udt * 2);
    Render.post.shakeX = Math.sin(Time.unscaledTime * 7) * 0.002;
  },
  *rewind() {
    const F = this.frames;
    if (F.length < 2) { this.frames = []; return; }
    this.IsRewinding = true; Time.scale = 0; LoopUI.ClearSpeech();
    const dur = clamp(F.length * this.interval / this.speedMul, this.minDur, this.maxDur);
    const line = LoopConfig.getRewindLine(LoopManager.CurrentLoop);
    let voiced = !line;
    const why = LoopManager.CurrentLoop === 3 && JumpScare.TryUse('why', 3);
    let crashed = false;
    this.preparePlayer(F[F.length - 1].scene);
    this.effects(true);
    play2D(SFX.rewindStatic);
    this.tape = Audio.play(SFX.rewindLoop, { loop: true, vol: SFX.sfxVolume * 0.8, cat: 'sfx' });
    yield* Fader.fade(0, 0.3);
    for (let e = 0; e < dur; e += Time.udt) {
      if (!voiced && e / dur >= 0.3) { LoopUI.Say(line, 1.5, LoopConfig.rewindSpeaker); voiced = true; }
      if (why && voiced && e / dur >= 0.62 && !LoopUI.IsSpeaking) { yield* this.rewindWhy(); crashed = true; break; }
      const u = smoothstep(0, 1, e / dur), index = (1 - u) * (F.length - 1), a = Math.floor(index), b = Math.min(a + 1, F.length - 1);
      const fa = F[a];
      if (!Scenes.current || Scenes.current.name !== fa.scene) {
        FX.rewind.noiseA = 0.9; play2D(SFX.rewindStatic, 0.7);
        Scenes.load(fa.scene, { rewinding: true }); this.preparePlayer(fa.scene);
      }
      const fb = F[b].scene === fa.scene ? F[b] : fa;
      this.apply(fa, fb, index - a);
      this.animate(u);
      if (this.tape) { const pr = e / dur, k = 6 * pr * (1 - pr) / 1.5; this.tape.setRate(0.8 + k * 0.6); }
      yield;
    }
    if (crashed) {
      this.effects(false); if (this.tape) this.tape.stop();
      if (!Scenes.current || Scenes.current.name !== F[0].scene) { Scenes.load(F[0].scene, { rewinding: true }); }
      this.apply(F[0], F[0], 0); yield;
      yield* Fader.fade(0, 0); yield;
      FX.snapshot = FX.takeSnapshot(); FX.snapshotAlpha = 1;
      this.HandoffPending = true; this.frames = []; Time.scale = 1; this.IsRewinding = false; Render.post.shakeX = 0;
      return;
    }
    this.apply(F[0], F[0], 0);
    while (LoopUI.IsSpeaking) { this.animate(1); yield; }
    const sv = this.tape ? this.tape.vol : 0;
    for (let e = 0; e < 0.5; e += Time.udt) { const n = 1 - e / 0.5; FX.rewind.alpha = n; Render.post.sat = lerp(1, 0.3, n); Render.post.chroma = n; if (this.tape) this.tape.setVol(sv * n); yield; }
    this.effects(false); if (this.tape) this.tape.stop(); Render.post.shakeX = 0;
    yield; // 효과 없는 한 프레임을 그린 뒤 화면을 찍는다 (WaitForEndOfFrame)
    FX.snapshot = FX.takeSnapshot(); FX.snapshotAlpha = 1;
    this.HandoffPending = true; this.frames = []; Time.scale = 1; this.IsRewinding = false;
  },
  *rewindWhy() {
    if (this.tape) this.tape.pause();
    for (let t = 0; t < 0.9; t += Time.udt) { FX.rewind.noiseA = 0.04; yield; }
    yield* JumpScare.ScreamStretched(['#WHY_Sister', '#WHY_Father', '#WHY_Mother'], LoopConfig.rewindSpeaker, v => FX.rewind.noiseA = v);
    if (this.tape) this.tape.stop();
    yield real(1.4);
  },
  *releaseSnapshot(d) {
    for (let t = 0; t < d; t += Time.udt) { FX.snapshotAlpha = 1 - t / d; yield; }
    FX.snapshotAlpha = 0; FX.snapshot = null; this.HandoffPending = false;
  }
};

function setActiveMap(name) {
  World.map = World.maps[name];
  World.entities = Scenes.current.entities.filter(e => !e.map || e.map === name);
}

// ================================================================== OutSide (지하철 + 거리)
Maps.cache = {};
function buildOutside(s, opts) {
  if (!Maps.cache.street) Maps.cache.street = buildStreet();
  const street = Maps.cache.street, train = buildTrain();
  for (const l of street.lamps) l.off = false; street.needRebuild = true; street.dyn = [];
  Object.assign(Train, { travel: 0, speed: 0, atStation: true, watchArrived: false, doorOpen: 0 });
  World.maps = { street, train };
  s.ambStreet = Scenes.sound(SFX.streetAmbience, { cat: 'ambience', loop: true, vol: 0, offset: rand(0, 180) });
  s.ambStation = Scenes.sound(SFX.stationAmbience, { cat: 'ambience', loop: true, vol: 0, offset: rand(0, 180) });
  s.stationMix = 1;
  const E = s.entities, add = (e, map = 'street') => { e.map = map; E.push(e); return e; };
  World.map = street; // 거리 물체 생성 시 맵 참조
  World.homeEntrance = add(new HomeEntrance(-25.2, -103.02));
  for (const c of CLUES.street) add(new ClueItem(c));
  // 숨는 곳 (사물함 3, 쓰레기통 3)
  const spots = [['HideSpot_Cabinet_2', 9.04, -60.92, 82.7, 'cabinet'], ['HideSpot_Cabinet_4', 54.0, -78.3, -180, 'cabinet'], ['HideSpot_Cabinet_6', 93.91, -62.31, -171.7, 'cabinet'],
  ['HideSpot_Dumpster_1', -13.9, -73.0, -90, 'dumpster'], ['HideSpot_Dumpster_3', 30.0, -52.89, -180, 'dumpster'], ['HideSpot_Dumpster_5', 73.61, -69.18, 107.4, 'dumpster']];
  for (const [n, x, z, yaw, k] of spots) {
    const r = k === 'dumpster' ? 1.1 : 0.7;
    fillRect(street, x - r, x + r, z - r, z + r, 0);
    let y = yaw; const fx = Math.sin(y * DEG), fz = Math.cos(y * DEG);
    if (cellType(street, x + fx * 1.6, z + fz * 1.6) && !cellType(street, x - fx * 1.6, z - fz * 1.6)) y += 180;
    add(new HidingLocker(n, x, z, y, k));
  }
  add(new CameraPickup(93.98, -96.49));
  const posters = add(new WantedPosters());
  add(new LampPosts(street));
  add(new SeekGirlE(42, -56));
  add(new QuizManE(-25.2, -101.6));
  add(new PhotophobiaE(82.67, -91.67));
  // 플레이어: 지하철 좌석 (OpeningCutscene.seatOffset)
  World.player = new Player(-2.95, -1.0, 0);
  World.player.eyeY = 1.17;
  setActiveMap('train');
  s.update = () => {
    // AmbienceMixer: 역 구역이면 역 소리, 아니면 거리 소리
    const inStation = World.map === train;
    s.stationMix = moveTowards(s.stationMix, inStation ? 1 : 0, 0.5 * Time.udt);
    let v = SFX.ambienceVolume; if (TimeRewind.IsRewinding) v *= 0.3; if (LoopManager.TruthEndingPending) v = 0;
    s.ambStreet && s.ambStreet.setVol(v * (1 - s.stationMix)); s.ambStation && s.ambStation.setVol(v * s.stationMix);
    if (World.map === street) JumpScare.tickAlley(s);
  };
  s.sprites = out => { if (JumpScare.alley && World.map === street) out.push(JumpScare.alley); };
  if (!opts.rewinding) Co.start(Opening.play(s), 'scene');
}

// ------------------------------------------------------------------ OpeningCutscene
const Opening = {
  IsPlaying: false, cruise: 14, brake: 90, start: 210, walkSpeed: 1.4, stairs: [5.7, 15],
  exitPath: [[-2.95, -0.7], [0, -0.1], [0, 1.2], [0, 2.6], [0, 4]],
  rememberLines: [[], [], ['조용하네..', '집에 도착하면 자야겠다.', '...오늘, 뭘 했더라.'], ['...오늘따라 유난히 피곤하네.', '...그 사람이 기다리고 있을 거야.', '... 쇠 냄새...'], ['...소매에 뭐가 묻었지.', '모르는 집 사진이... 왜 자꾸 떠오르지.', '집에 가면... 쉴 수 있을까.'], ['...카메라 가방이 가볍다.', '필름은... 어디 뒀더라.', '...그 여자는 셔터 소리를 싫어했지.'], ['그 집 문은... 아버지가 열어 줬었지.', '...내가 그걸 어떻게 알지.', '그만. 생각하지 마.'], ['...그 아이가 나왔어.', '숨어 있으라고 했는데... 나왔어.', '그래서... 나는...'], ['조용하네..', '...아니. 아무 일도 없었어.', '...없었어야 해.'], ['...다 기억났어.', '그래도... 집으로 가야 해.', '그 사람들이 기다리고 있으니까.']],
  forgetLines: [[], [], ['조용하네..', '집에 도착하면 자야겠다.', '...오늘, 무슨 일이 있었던가.'], ['...오늘 뭘 했더라.', '머리가... 멍하다.', '집에 가면 쉬자.'], ['...그 집 앞은, 그냥 지나갔을 뿐이야.', '나는 그냥 집에 가는 중이었어.', '...'], ['...검은 옷을 입은 남자였어.', '그래. 나는 그 남자를 봤어.', '...'], ['...경찰한테 다 말했잖아.', '왜 아직도 못 잡는 거야.', '...'], ['...나는 목격자야.', '범인이 아니라... 목격자야.', '...'], ['...그 남자가 날 보고 있었어.', '다음은... 나일지도 몰라.', '...'], ['...범인은 아직 이 근처에 있어.', '경찰은 믿을 수 없어. 내가 찾아야 해.', '...']],
  pickLines() {
    const loop = LoopManager.CurrentLoop, arr = LoopManager.FoundCount >= loop - 2 ? this.rememberLines : this.forgetLines;
    const l = arr[loop - 1]; return l && l.length ? l : ['조용하네..', '집에 도착하면 자야겠다.'];
  },
  sit() { const p = World.player; p.x = -2.95; p.z = -1.0; p.eyeY = 1.17 + (Train.speed > 0 ? (perlin(Time.time * 9) - 0.5) * 2 * 0.012 * clamp01(Train.speed / this.cruise) : 0); },
  *play(s) {
    this.IsPlaying = true; const p = World.player, m = World.maps.train;
    p.movementLocked = true; PlayerState.InputLocked = true;
    const seamless = TimeRewind.HandoffPending;
    if (!seamless) Fader.alpha = 1;
    Train.travel = -this.start; Train.speed = this.cruise; Train.atStation = false; p.yaw = 0; p.pitch = 0;
    this.sit();
    TimeRewind.restartRecording();
    if (!seamless) Fader.start(0, 2);
    if (LoopManager.TruthEndingPending) { yield* this.truthRide(s); return; }
    if (LoopManager.LostEndingPending) { yield* this.lostRide(s); return; }
    Co.start(this.monologue(), 'scene');
    if (LoopManager.CurrentLoop === 2) Co.start((function* () { yield 6; yield* JumpScare.subwayGirl(s); })(), 'scene');
    yield* this.arrive();
    yield* LoopUI.WaitForSpeech();
    yield* this.openDoors();
    yield* this.exitTrain(true);
  },
  *arrive() {
    let braking = false; const decel = this.cruise * this.cruise / (2 * this.brake); Train.speed = this.cruise; Train.atStation = false;
    for (; ;) {
      const rem = -Train.travel;
      if (rem <= this.brake) { braking = true; Train.speed = Math.sqrt(2 * decel * Math.max(0, rem)); }
      if (rem <= 0.02 || (braking && Train.speed < 0.05)) break;
      Train.travel += Math.min(Train.speed * Time.dt, rem); this.sit(); yield;
    }
    Train.travel = 0; Train.speed = 0; Train.atStation = true; this.sit();
  },
  *openDoors() {
    Scenes.sound('Subway_door_open', { vol: 1 });
    Train.watchArrived = true;
    yield 1;
    yield 1.2; setTrainDoors(World.maps.train, true);
    yield 0.5;
  },
  *movePlayer(a, b, dur, face) {
    const p = World.player; let last = a, step = 0; const dirYaw = yawTo(a[0], a[1], b[0], b[1]);
    for (let t = 0; t < dur; t += Time.dt) {
      const k = smoothstep(0, 1, t / dur); p.x = lerp(a[0], b[0], k); p.z = lerp(a[1], b[1], k);
      if (face) { step += dist2(last[0], last[1], p.x, p.z); if (step >= 0.62) { step = 0; p.playFootstep(0.8); } p.yaw = lerpAngle(p.yaw, dirYaw, Time.dt * 4); }
      last = [p.x, p.z]; yield;
    }
    p.x = b[0]; p.z = b[1];
  },
  walkToward(tx, tz) {
    const p = World.player, dx = tx - p.x, dz = tz - p.z, L = Math.hypot(dx, dz); if (L < 0.1) return;
    p.x += dx / L * this.walkSpeed * Time.dt; p.z += dz / L * this.walkSpeed * Time.dt;
    p.yaw = lerpAngle(p.yaw, yawTo(0, 0, dx, dz), Time.dt * 3);
    this.stepT = (this.stepT || 0) + this.walkSpeed * Time.dt; if (this.stepT >= 0.62) { this.stepT = 0; p.playFootstep(0.8); }
  },
  *standUp() { const p = World.player, e0 = p.eyeY, P0 = this.exitPath[0]; const a = [p.x, p.z]; for (let t = 0; t < 0.8; t += Time.dt) { const k = smoothstep(0, 1, t / 0.8); p.x = lerp(a[0], P0[0], k); p.z = lerp(a[1], P0[1], k); p.eyeY = lerp(e0, 1.62, k); yield; } },
  *exitTrain(normal) {
    const p = World.player;
    yield* this.standUp();
    for (let i = 1; i < this.exitPath.length; i++) { const a = this.exitPath[i - 1], b = this.exitPath[i]; yield* this.movePlayer(a, b, dist2(...a, ...b) / this.walkSpeed, true); }
    Co.start(this.depart(), 'scene');
    let fading = null, el = 0;
    while (!fading || Fader.alpha < 0.999) {
      this.walkToward(this.stairs[0], this.stairs[1]); el += Time.dt;
      if (!fading && (el >= 3 || dist2(p.x, p.z, ...this.stairs) <= 2.5)) fading = Fader.start(1, 1.5);
      yield;
    }
    // 계단 → 거리 (StairTeleport.destination)
    const d = window.STREET_MAP.stairDest; const [sx, sz] = nearestWalkable(World.maps.street, d[0], d[2]);
    setActiveMap('street'); p.x = sx; p.z = sz; p.eyeY = 1.62;
    if (!normal) return;
    yield 1;
    yield* Fader.fade(0, 1.5);
    p.movementLocked = false; PlayerState.InputLocked = false; this.IsPlaying = false;
  },
  *depart() { yield 1; setTrainDoors(World.maps.train, false); yield 2.2; Scenes.sound('metro_leaving', { vol: 0.9 }); },
  *monologue() { yield 2.5; for (const l of this.pickLines()) LoopUI.Say(l, 2.2); },
  // 단서를 다 모으지 못한 채 마지막 반복을 끝냈을 때: 멈춘 지하철에 가족이 나타난다 → Ending 02
  *truthRide(s) {
    const p = World.player, ui = LoopUI, m = World.maps.train;
    Train.speed = 0; Train.travel = -this.start; Train.atStation = false;
    yield 2.5;
    ui.Say('...그 사람이랑 살 집을, 다시 찾아야 해.', 0.6); yield* ui.WaitForSpeech(); yield 0.9;
    ui.Say('...네 사진 속의 나는, 한 번도 웃고 있지 않았어.', 2, '???', null, 3.2 * 0.8); yield* ui.WaitForSpeech(); yield 0.4;
    ui.Say('너를 고통속에 넣을려고 얼마나 기다렸는데.', 2.5, '???'); yield* ui.WaitForSpeech(); yield 0.6;
    setTrainLights(m, false); yield* Fader.fade(0.95, 0.05);
    p.enabled = false; p.yaw = 0;
    const [fx, fz] = [0, 1], [rx, rz] = [1, 0];
    const girl = { x: p.x + fx * 1.05, z: p.z + fz * 1.05, y: 0, w: 0.75, h: 1.5, tex: Spr.girlButtons };
    const father = { x: p.x + fx * 1.35 - rx * 0.62, z: p.z + fz * 1.35 - rz * 0.62, y: 0, w: 0.85, h: 1.85, tex: Spr.father };
    const mother = { x: p.x + fx * 1.35 + rx * 0.62, z: p.z + fz * 1.35 + rz * 0.62, y: 0, w: 0.8, h: 1.75, tex: Spr.mother };
    s.extraSprites.push(girl, father, mother);
    yield 0.9;
    setTrainLights(m, true); yield* Fader.fade(0, 0.05);
    Audio.play('jumpscare_sound1', { cat: 'jumpscare', vol: 1, rate: 2 });
    const hold = Co.start((function* () { for (; ;) { p.pitch = lerp(p.pitch, -12, Time.dt * 3); p.yaw = 0; yield; } })(), 'scene');
    yield 1.6;
    ui.Say('내 가족을 죽여놓고, 아직도 편히 살거라 생각했어?', 3, '???', father); yield* ui.WaitForSpeech(); yield 0.5;
    ui.Say('이젠 너 차례야.', 2.2, '???', null, 3.2); yield* ui.WaitForSpeech(); yield 0.3;
    ui.ClearSpeech(); yield* Fader.fade(1, 0);
    playLoud('Sword_hit', 1); playLoud('Sword_hit', 1);
    Co.stop(hold);
    yield Math.max(1.5, (Audio.duration('Sword_hit') || 1.3) + 0.3);
    LoopFlow.LoadTruthEnding();
  },
  // 단서를 전부 모은 채 마지막 반복을 끝냈을 때: 내리려 할 때마다 되풀이 → 경찰 → Ending 01
  *lostRide(s) {
    const p = World.player, lost = ['...경찰서에 다시 가야 해.', '범인을 본 건, 나뿐이니까.'];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        setTrainDoors(World.maps.train, false); Train.watchArrived = false; Train.travel = -120; Train.speed = this.cruise; Train.atStation = false;
        p.yaw = 0; p.pitch = 0; p.eyeY = 1.17; this.sit();
      }
      Co.start((function* () { yield attempt === 0 ? 2.5 : 1.2; for (const l of lost) LoopUI.Say(l, 2.2); })(), 'scene');
      yield* this.arrive();
      yield* LoopUI.WaitForSpeech(); yield 0.6;
      Scenes.sound('Subway_door_open', { vol: 1 }); Train.watchArrived = true;
      yield 1; setTrainDoors(World.maps.train, true); yield 1.7;
      yield* this.standUp();
      yield* this.movePlayer(this.exitPath[0], this.exitPath[1], dist2(...this.exitPath[0], ...this.exitPath[1]) / this.walkSpeed, true);
      yield* this.movePlayer(this.exitPath[1], this.exitPath[2], dist2(...this.exitPath[1], ...this.exitPath[2]) / this.walkSpeed, true);
      if (attempt === 0) { yield* this.glitch(); continue; }
      for (let i = 3; i < this.exitPath.length; i++) yield* this.movePlayer(this.exitPath[i - 1], this.exitPath[i], dist2(...this.exitPath[i - 1], ...this.exitPath[i]) / this.walkSpeed, true);
      if (attempt === 1) { for (let t = 0; t < 2.2; t += Time.dt) { this.walkToward(...this.stairs); yield; } yield* this.glitch(); continue; }
      Co.start(this.depart(), 'scene');
      let fading = null;
      for (let t = 0; !fading || Fader.alpha < 0.999; t += Time.dt) { this.walkToward(...this.stairs); if (!fading && t >= 3) fading = Fader.start(1, 1.5); yield; }
      const d = window.STREET_MAP.stairDest; const [sx, sz] = nearestWalkable(World.maps.street, d[0], d[2]);
      setActiveMap('street'); p.x = sx; p.z = sz; p.eyeY = 1.62; p.yaw = 0;
      yield* LostEnding.playStreet(s);
      return;
    }
  },
  *glitch() { LoopUI.ClearSpeech(); FX.Glitch(0.14); play2D(SFX.rewindStatic, 0.9); yield 0.1; }
};

// ------------------------------------------------------------------ LostEndingDirector (경찰)
const LostEnding = {
  *playStreet(s) {
    const p = World.player, ui = LoopUI, m = World.maps.street;
    p.pitch = 0;
    const siren = Scenes.sound(Proc.siren, { cat: 'ambience', loop: true, vol: 0 });
    const setSiren = (v, cut) => { siren.setVol(v); siren.setLowpass(cut); };
    yield 0.8;
    Fader.start(0, 1.5); setSiren(0.05, 700);
    const [fx, fz] = p.forward(), tx = p.x + fx * 5, tz = p.z + fz * 5;
    let step = 0;
    const walk = (x, z, mul = 1) => {
      const dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz); if (L < 1e-3) return;
      const n = Math.min(L, 1.3 * mul * Time.dt); p.x += dx / L * n; p.z += dz / L * n;
      p.yaw = lerpAngle(p.yaw, yawTo(0, 0, dx, dz), Time.dt * 3);
      step += n; if (step >= 0.62) { step = 0; p.playFootstep(0.8); }
    };
    for (let t = 0; t < 3.5; t += Time.dt) { walk(p.x + fx * 5, p.z + fz * 5); yield; }
    yield* Fader.fade(1, 1);
    p.x = -25.2; p.z = -84; p.yaw = 180;
    yield 0.6; Fader.start(0, 1.2);
    const stand = [-25.2, -99.3], d0 = dist2(p.x, p.z, ...stand);
    while (dist2(p.x, p.z, ...stand) > 0.15) { walk(...stand); const k = 1 - dist2(p.x, p.z, ...stand) / d0; setSiren(lerp(0.08, 0.35, k), lerp(900, 3500, k)); yield; }
    yield* this.turn(-25.2, -104, 1.2, 0);
    yield 1.2;
    ui.Say('...여기야. 그날 밤, 내가 범인을 본 곳.', 2); yield* ui.WaitForSpeech(); yield 0.6;
    // 경찰 등장 (뒤돌아보기 전까지 꺼 둔다)
    const car = { x: -25, z: -89, y: 0, w: 4.4, h: 1.65, tex: Spr.policeCar };
    const shooter = { x: -24.3, z: -94.6, y: 0, w: 0.75, h: 1.8, tex: Spr.policeAim };
    const partner = { x: -26.0, z: -95.4, y: 0, w: 0.75, h: 1.8, tex: Spr.policeAim };
    s.extraSprites.push(car, shooter, partner);
    const red = { x: -25.45, z: -89, y: 1.75, r: 14, i: 0, c: [1, 0.1, 0.1], k: 0.5 }, blue = { x: -24.55, z: -89, y: 1.75, r: 14, i: 0, c: [0.1, 0.3, 1], k: 0.5 };
    s.policeLights = [red, blue];
    const lights = Co.start((function* () { for (; ;) { const f = (Time.time * 2.2) % 1 < 0.5, n = (Time.time * 9) % 1 < 0.55 ? 1 : 0.15; red.i = f ? 7 * n : 0; blue.i = f ? 0 : 7 * n; yield; } })(), 'scene');
    setSiren(0.55, 22000);
    yield* this.turn(shooter.x, shooter.z, 1.1, -6);
    yield 0.4;
    Co.start((function* () { const v = siren.vol; for (let t = 0; t < 1.2; t += Time.dt) { siren.setVol(lerp(v, 0, t / 1.2)); yield; } siren.stop(); })(), 'scene');
    ui.Say('움직이지 마! 손 머리 위로!', 1.6, '경찰', shooter);
    ui.Say('목격자라던 당신이... 범인이었군.', 2, '경찰', partner);
    yield* ui.WaitForSpeech();
    ui.Say('...네? 저는 목격자예요. 범인을 봤다니까요.', 1.8);
    ui.Say('검은 옷을 입은 남자였어요... 그 남자가 아직 이 근처에...', 2.2);
    yield* ui.WaitForSpeech();
    ui.Say('거기 서! 한 발짝만 더 오면 쏜다!', 1.6, '경찰', shooter); yield* ui.WaitForSpeech();
    ui.Say('잠깐만요, 범인은 따로 있어요! 저는 그냥...', 3);
    for (let t = 0; t < 1.6; t += Time.dt) { walk(shooter.x, shooter.z, 0.55); yield; }
    yield (0.3 - 0.12) * 1.2;
    playLoud(Proc.gunshot);
    const flash = { x: shooter.x, z: shooter.z, y: 1.4, r: 9, i: 30, c: [1, 0.85, 0.6], k: 0.5 }; s.extraLights = [flash];
    for (let t = 0; t < 0.09; t += Time.dt) { Render.post.shakeX = rand(-1, 1) * 0.02; Render.post.shakeY = rand(-1, 1) * 0.02; p.pitch = -4 + rand(-6, 6); p.roll = rand(-8, 8); if (t > 0.05) flash.i = 0; yield; }
    flash.i = 0; Render.post.shakeX = Render.post.shakeY = 0; p.roll = 0;
    ui.ClearSpeech(); yield* Fader.fade(1, 0);
    Co.stop(lights); red.i = blue.i = 0; siren.stop();
    yield 2.2;
    LoopFlow.LoadEndingScene(true);
  },
  *turn(tx, tz, time, pitch) {
    const p = World.player, from = p.yaw, to = yawTo(p.x, p.z, tx, tz), pf = p.pitch;
    for (let t = 0; t < time; t += Time.dt) { const k = smoothstep(0, 1, t / time); p.yaw = from + deltaAngle(from, to) * k; p.pitch = lerp(pf, pitch, k); yield; }
    p.yaw = to; p.pitch = pitch;
  }
};

// ================================================================== Home
function buildHomeScene(s, opts) {
  const m = buildHome(); World.maps = { home: m };
  const E = s.entities, add = e => { e.map = 'home'; E.push(e); return e; };
  World.map = m;
  for (const c of CLUES.home) add(new ClueItem(c));
  add(new Bed()); add(new MedicationPile());
  E.push({ map: 'home', sprites(out) { out.push({ x: 2.3, z: 0.05, y: 0.7, w: 0.8, h: 0.6, tex: Spr.tv }); } });
  World.player = new Player(1.5, -2.2, -20);
  World.player.radius = 0.25;
  setActiveMap('home');
  if (!opts.rewinding) {
    // HomeDirector: 도착 혼잣말 (기억을 잃을수록 다른 말)
    const lines = ['오늘도 피곤하다. 빨리 자야지.', '...이상하다. 오늘 하루가 잘 기억이 안 나.', '집이... 원래 이렇게 조용했나?', '여기가 내 방... 맞지?', '누가... 날 부르는 것 같은데.', '...'];
    if (LoopManager.IsFinalLoop && LoopManager.AllCluesFound) LoopUI.Say('...전부 기억났어. 여긴... 내 집이 아니었어.', 3);
    else LoopUI.Say(lines[Math.round(LoopManager.MemoryLoss * (lines.length - 1))], 3);
  }
}

// ================================================================== Ending (TV 뉴스 + 크레딧)
const Ending = {
  LostVariant: false, tvOn: false, credit: { text: '', alpha: 0, logo: false }, title: { text: '', alpha: 0 }, glow: 0,
  credits: [
    'Thank you For Playing!',
    '<size=70%><color=#9a9a9a>Special Thanks</color></size>\nSound Effects\n\n<size=62%>Girl humming Eerie, Spooky, Horror - Darklitstudio\nBin.wav - Ameliezee\nSpooky Sucking Air - hykenfreak\nViolin Scare - SirBedlam\nSound From The Depths 4 - SilverIllusionist\n\n<color=#9a9a9a>source : freesound.org</color></size>',
    '<size=70%><color=#9a9a9a>Special Thanks</color></size>\nModels\n\n<size=62%>JAPANESE CITY  | Modular Pack V1.4 - TRACY AVENUE & CO.\n<color=#9a9a9a>source : Unity Asset Store</color>\n\nSubway Car (R62A) - Subin\nsubway - kunkun\nTunnel_Station_SuBway - haddly Anand Kumar S\n<color=#9a9a9a>source : sketchfab.com</color></size>',
    '<size=70%><color=#9a9a9a>Special Thanks</color></size>\nVoice Actors\n\n<size=62%>주인공 (Protagonist) - Arthur\n아버지 (Father) - Andrew\n어머니 (Mother) - Glinda\n딸 (Daughter) - Anime_Girl\n경찰 (Police) - Clyde, Dave\n뉴스 앵커 (News Anchor) - Lily_Narrator\n\nDeepVoice AI - AiKodex</size>'
  ],
};
function buildEndingScene(s) {
  World.player = null; World.map = null;
  Ending.tvOn = false; Ending.credit.alpha = 0; Ending.title.alpha = 0; Ending.glow = 0;
  s.draw = drawEndingRoom;
  Co.start(endingRun(s), 'scene');
}
function* endingRun(s) {
  const ui = LoopUI, E = Ending;
  ui.ClearSpeech();
  yield 1.2; yield* Fader.fade(0, 2.5); yield 1.5;
  Audio.play(Proc.tvClick, { vol: 0.9 });
  for (let t = 0; t < 0.35; t += Time.dt) { E.glow = lerp(3, 1, t / 0.35) * (Math.random() < 0.3 ? 0.2 : 1); E.tvOn = true; yield; }
  E.tvOn = true;
  const stat = Scenes.sound(SFX.rewindStatic, { cat: 'ambience', loop: true, vol: 0.12 });
  yield 1.2;
  const n1 = E.LostVariant ? '오늘 새벽, 한 남성이 경찰의 체포 과정에서 총에 맞아 구급차로 이송되던 중 숨졌습니다.' : '오늘, 어떤 한 남성이 사망하였습니다. 그 남성의 시체는 머리, 눈, 팔 등 잔인하게 잘려 형체를 알아보기 힘들 정도로 한 건물에 발견이 됐습니다.';
  const n2 = E.LostVariant ? '경찰은 이 남성이 미궁에 빠져 있던 ○○동 부녀 살인 사건의..' : '그 남성은 한 가족을 죽음으로 몰아넣은..';
  const v1 = Audio.voice(E.LostVariant ? '#NEWS_LOST_1' : '#NEWS_1'), v2 = Audio.voice(E.LostVariant ? '#NEWS_LOST_2' : '#NEWS_2');
  let news = v1 ? Scenes.sound(v1, { cat: 'voice', vol: 0.9 }) : null;
  const len1 = v1 ? Audio.duration(v1) || 12 : 0;
  ui.Say(n1, v1 ? Math.max(2, len1 * 0.55) : 5, '뉴스');
  if (news) { const t0 = Time.time; yield until(() => !news.playing || Time.time - t0 > len1 + 1); } else yield 8;
  yield* ui.WaitForSpeech(); yield 0.5;
  news = v2 ? Scenes.sound(v2, { cat: 'voice', vol: 0.9 }) : null;
  const len2 = v2 ? Audio.duration(v2) || 20 : 4;
  ui.Say(n2, Math.max(1, len2 * 1 - n2.length / ui.charsPerSecond - 0.35), '뉴스');
  yield 2.2;
  Co.start((function* () {
    if (!news) return; const v = news.vol;
    for (let t = 0; t < 5; t += Time.dt) { const k = t / 5; news.setVol(lerp(v, v * 0.12, k)); news.setLowpass(lerp(22000, 900, k)); stat.setVol(lerp(stat.vol, 0.02, Time.dt)); yield; }
    ui.ClearSpeech();
  })(), 'scene');
  // 크레딧
  const block = function* (text, hold, logo = false) {
    E.credit.text = text; E.credit.logo = logo;
    for (let t = 0; t < 2; t += Time.dt) { E.credit.alpha = smoothstep(0, 1, t / 2); yield; }
    E.credit.alpha = 1; yield hold;
    for (let t = 0; t < 2; t += Time.dt) { E.credit.alpha = 1 - smoothstep(0, 1, t / 2); yield; }
    E.credit.alpha = 0; yield 0.8;
  };
  yield* block('', 4.5, true);
  for (const c of E.credits) yield* block(c, 4.5 + Math.min(2.5, c.split('\n').length * 0.25));
  yield* Fader.fade(1, 2);
  if (news) news.stop(); stat.stop();
  yield 1.5;
  Settings.LastEnding = E.LostVariant ? 1 : 2;
  E.title.text = E.LostVariant ? 'Ending 01 - 리플리' : 'Ending 02 - 복수';
  for (let t = 0; t < 2.5; t += Time.dt) { E.title.alpha = smoothstep(0, 1, t / 2.5); yield; }
  E.title.alpha = 1; yield 3;
  for (let t = 0; t < 2.5; t += Time.dt) { E.title.alpha = 1 - smoothstep(0, 1, t / 2.5); yield; }
  E.title.alpha = 0; yield 1;
  LoopFlow.ReturnToLobby();
}
// 원본 Ending 씬: 어두운 방, 텔레비전 빛 (3D 방 대신 그림으로)
function drawEndingRoom() {
  const g = UI.g, cw = UI.cw, ch = UI.ch, E = Ending;
  g.fillStyle = '#030304'; g.fillRect(0, 0, cw, ch);
  const flick = E.tvOn ? (0.8 + perlin(Time.time * 7, 0.3) * 0.35) * (Math.random() < 0.02 ? 0.6 : 1) * (E.glow > 1.01 ? E.glow : 1) : 0;
  const tx = cw * 0.27, ty = ch * 0.5, tw = cw * 0.26, th = tw * 0.6;
  if (flick > 0) {
    const r = g.createRadialGradient(tx, ty, 10, tx, ty, cw * 0.55);
    r.addColorStop(0, `rgba(150,170,210,${0.32 * flick})`); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, cw, ch);
  }
  // 바닥과 TV 장
  g.fillStyle = '#0b0a0a'; g.fillRect(0, ch * 0.72, cw, ch * 0.28);
  g.fillStyle = `rgba(20,18,16,1)`; g.fillRect(tx - tw * 0.7, ty + th * 0.55, tw * 1.4, ch * 0.18);
  g.fillStyle = '#0a0a0a'; g.fillRect(tx - tw / 2 - 12, ty - th / 2 - 12, tw + 24, th + 24);
  if (E.tvOn) {
    const sg = g.createLinearGradient(0, ty - th / 2, 0, ty + th / 2); sg.addColorStop(0, `rgba(170,190,230,${0.9 * flick})`); sg.addColorStop(1, `rgba(90,110,150,${0.9 * flick})`);
    g.fillStyle = sg; g.fillRect(tx - tw / 2, ty - th / 2, tw, th);
    g.save(); g.beginPath(); g.rect(tx - tw / 2, ty - th / 2, tw, th); g.clip(); Render.drawNoise(g, cw, ch, 0.18);
    g.fillStyle = 'rgba(20,30,60,0.5)'; g.fillRect(tx - tw / 2, ty + th * 0.25, tw, th * 0.25);
    g.restore();
  } else { g.fillStyle = '#060708'; g.fillRect(tx - tw / 2, ty - th / 2, tw, th); }
  // 크레딧 (오른쪽)
  if (E.credit.alpha > 0.001) {
    if (E.credit.logo && Img.logo) {
      const ax0 = 0.6 * cw, ay0 = 0.2 * ch, aw = 0.32 * cw, ah = 0.6 * ch, im = Img.logo, r = Math.min(aw / im.width, ah / im.height);
      g.save(); g.globalAlpha = E.credit.alpha; g.drawImage(im, ax0 + (aw - im.width * r) / 2, ay0 + (ah - im.height * r) / 2, im.width * r, im.height * r); g.restore();
    } else if (E.credit.logo) UI.textBox('<size=150%>Dejavu</size>\n<size=60%><color=#9a9a9a>데자뷰</color></size>', 0.52, 0.08, 0.97, 0.92, 54, { valign: 'middle', alpha: E.credit.alpha, color: '#ebebeb' });
    else UI.textBox(E.credit.text, 0.52, 0.08, 0.97, 0.92, 54, { valign: 'middle', alpha: E.credit.alpha, color: '#ebebeb', lineSpacing: 1.35, shadow: false });
  }
}
function drawEndingTitle() {
  const E = Ending; if (E.title.alpha <= 0.001) return;
  const g = UI.g; g.save(); g.globalAlpha = E.title.alpha; g.font = UI.font(64, 700); g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${4 * UI.s}px`;
  g.fillStyle = '#e6e6e6'; g.fillText(E.title.text, UI.cw / 2, UI.ch / 2); g.restore();
}
