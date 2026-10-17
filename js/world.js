// 월드: 플레이어(FirstPersonController/PlayerHealth/PlayerSound/PlayerInteractor), 상호작용 물체, 숨는 곳, 단서
'use strict';

const World = {
  scene: null, map: null, maps: {}, entities: [], player: null, homeEntrance: null, flashLight: 0, sprites: [],
  camOverride: null,
  isStreet() { return this.map && this.map.name === 'street'; },
  camera() {
    const p = this.player; if (!p) return { x: 0, z: 0, y: 1.6, yaw: 0, pitch: 0, fov: 60 };
    return { x: p.x, z: p.z, y: p.eyeY + p.camOffY + p.jumpY, yaw: p.yaw, pitch: p.pitch, fov: FilmCamera.Holding ? FilmCamera.zoomFov : 60, roll: p.roll };
  },
  // Unity Camera.WorldToViewportPoint 대응 (x,y 0~1, z = 깊이)
  toViewport(cam, x, y, z) {
    const yaw = cam.yaw * DEG, pitch = cam.pitch * DEG;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const lat = dx * rx + dz * rz, fwdFlat = dx * fx + dz * fz;
    // 피치 적용
    const depth = fwdFlat * Math.cos(pitch) - dy * Math.sin(pitch);
    const up = fwdFlat * Math.sin(pitch) + dy * Math.cos(pitch);
    const tanV = Math.tan((cam.fov || 60) * DEG / 2), tanH = tanV * Render.canvas.width / Render.canvas.height;
    return { x: 0.5 + lat / depth / tanH / 2, y: 0.5 + up / depth / tanV / 2, z: depth };
  },
  add(e) { this.entities.push(e); return e; },
  find(fn) { return this.entities.find(fn); },
};

// ------------------------------------------------------------------ 플레이어
class Player {
  constructor(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0; this.roll = 0;
    this.eyeY = 1.62; this.camOffY = 0; this.vy = 0; this.jumpY = 0;
    this.walkSpeed = 3.5; this.runSpeed = 6; this.crouchSpeed = 1.8; this.jumpHeight = 1.1; this.gravity = -19.62;
    this.movementLocked = false; this.enabled = true; this.crouching = false; this.radius = 0.22;
    this.health = 100; this.maxHealth = 100; this.lastDamage = -99; this.alive = true;
    this.bobTimer = 0; this.currentSpeed = 0; this.running = false; this.noCollide = false;
  }
  get IsAlive() { return this.health > 0; }
  takeDamage(d) {
    if (!this.IsAlive) return;
    this.health = Math.max(0, this.health - d); this.lastDamage = Time.time;
    if (this.health <= 0) LoopFlow.PassOut();
  }
  update() {
    const dt = Time.dt;
    if (PlayerState.Paused || dt <= 0) return;
    // 체력 회복 (피격 6초 후 초당 4)
    if (this.IsAlive && Time.time - this.lastDamage >= 6 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 4 * dt);
    if (!this.enabled) { this.currentSpeed = 0; return; }
    // 마우스 시점 (Unity Mouse X 축 = 픽셀 * 0.1)
    if (!TimeRewind.IsRewinding) {
      const sens = Settings.MouseSensitivity * 0.1;
      this.yaw += Input.mouseDX * sens;
      this.pitch = clamp(this.pitch + Input.mouseDY * sens, -85, 85);
    }
    // 이동
    if (this.movementLocked) { this.currentSpeed = 0; this.running = false; this.bobTimer = 0; this.camOffY = lerp(this.camOffY, 0, dt * 6); return; }
    if (Input.hit('ControlLeft')) this.crouching = !this.crouching; // 원본도 카메라 높이는 그대로, 속도만 줄어든다
    let ax = (Input.key('KeyD') || Input.key('ArrowRight') ? 1 : 0) - (Input.key('KeyA') || Input.key('ArrowLeft') ? 1 : 0);
    let az = (Input.key('KeyW') || Input.key('ArrowUp') ? 1 : 0) - (Input.key('KeyS') || Input.key('ArrowDown') ? 1 : 0);
    const y = this.yaw * DEG, fx = Math.sin(y), fz = Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
    let mx = rx * ax + fx * az, mz = rz * ax + fz * az; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    let sp = this.walkSpeed; this.running = false;
    if (this.crouching) sp = this.crouchSpeed;
    else if (Input.key('ShiftLeft') && az > 0.1) { sp = this.runSpeed; this.running = true; }
    const ox = this.x, oz = this.z;
    this.move(mx * sp * dt, mz * sp * dt);
    this.currentSpeed = Math.hypot(this.x - ox, this.z - oz) / dt;
    // 점프
    if (Input.hit('Space') && this.jumpY <= 0 && !this.crouching) this.vy = Math.sqrt(this.jumpHeight * -2 * this.gravity);
    if (this.vy || this.jumpY > 0) { this.vy += this.gravity * dt; this.jumpY = Math.max(0, this.jumpY + this.vy * dt); if (this.jumpY <= 0) this.vy = 0; }
    // 머리 흔들림 + 발소리
    if (this.jumpY <= 0 && this.currentSpeed > 0.1) {
      const k = clamp(this.currentSpeed / this.walkSpeed, 0.55, 1.6), prev = this.bobTimer;
      this.bobTimer += dt * 8 * k;
      if (prev === 0 || Math.floor(this.bobTimer / Math.PI) > Math.floor(prev / Math.PI)) this.footstep(this.running ? 1 : 0.85);
      this.camOffY = (Math.abs(Math.sin(this.bobTimer)) - 0.5) * 0.04 * 1.6;
    } else { this.bobTimer = 0; this.camOffY = lerp(this.camOffY, 0, dt * 6); }
  }
  footstep(vol) { if (!PlayerState.InputLocked && this.currentSpeed >= 0.5) Audio.play(SFX.footsteps[randInt(0, 6)], { vol, cat: 'sfx' }); }
  playFootstep(vol = 1) { Audio.play(SFX.footsteps[randInt(0, 6)], { vol, cat: 'sfx' }); }
  blocked(x, z) {
    const m = World.map, r = this.radius;
    if (cellType(m, x, z) || cellType(m, x + r, z) || cellType(m, x - r, z) || cellType(m, x, z + r) || cellType(m, x, z - r)) return true;
    for (const e of World.entities) if (e.solid && e.active !== false && dist2(x, z, e.x, e.z) < e.solid + r) return true;
    return false;
  }
  move(dx, dz) {
    if (this.noCollide) { this.x += dx; this.z += dz; return; }
    if (!this.blocked(this.x + dx, this.z)) this.x += dx;
    if (!this.blocked(this.x, this.z + dz)) this.z += dz;
  }
  get eye() { return { x: this.x, y: this.eyeY + this.jumpY, z: this.z }; }
  forward() { const y = this.yaw * DEG; return [Math.sin(y), Math.cos(y)]; }
}

// ------------------------------------------------------------------ 상호작용 (PlayerInteractor: 화면 가운데 레이 3m)
const Interactor = {
  current: null,
  update() {
    const p = World.player;
    if (!p || PlayerState.IsHidden || PlayerState.InputLocked || PlayerState.Paused || TimeRewind.IsRewinding) { LoopUI.HidePrompt(); this.current = null; return; }
    const cam = World.camera(), yaw = cam.yaw * DEG, pitch = cam.pitch * DEG;
    const dx = Math.sin(yaw) * Math.cos(pitch), dz = Math.cos(yaw) * Math.cos(pitch), dy = -Math.sin(pitch);
    let best = null, bt = 1e9;
    for (const e of World.entities) {
      if (!e.interact || e.active === false || e.hidden || !e.prompt()) continue;
      const r = e.radius || 0.4, ey = e.iy ?? 0.5;
      const qx = e.x - cam.x, qy = ey - cam.y, qz = e.z - cam.z;
      const t = qx * dx + qy * dy + qz * dz; if (t < 0 || t > 3 + r) continue;
      const px = cam.x + dx * t - e.x, py = cam.y + dy * t - ey, pz = cam.z + dz * t - e.z;
      const hr = e.hr || r;
      if (Math.hypot(px, pz) > r || Math.abs(py) > hr) continue;
      if (!sightClear(World.map, cam.x, cam.z, e.x - dx * 0.3, e.z - dz * 0.3)) continue;
      if (t < bt) { bt = t; best = e; }
    }
    this.current = best;
    if (best) LoopUI.ShowPrompt(best.prompt()); else LoopUI.HidePrompt();
    if (best && Input.hit('KeyE')) best.interact();
  }
};

// ------------------------------------------------------------------ 단서 (ClueItem)
let clueNoticeTime = -999;
class ClueItem {
  constructor(c) {
    Object.assign(this, { x: c.x, z: c.z, y: c.y || 0.05, data: c, id: 'clue:' + c.id, radius: 0.45, iy: (c.y || 0.05) + 0.1, hr: 0.5 });
    this.sparkleH = c.notice === 0 ? 0.25 : 0.45; this.noticeDistance = c.notice ?? 7; this.noticed = false; this.seed = Math.random() * 10;
    this.active = !(LoopManager.CurrentLoop < c.minLoop || LoopManager.HasClue(c.id) || LoopManager.LostEndingPending);
    this.sprite = { x: this.x, z: this.z, y: this.y, w: 0.45, h: 0.22, tex: Spr.paper };
    if (c.id === 'family_photo') this.sprite = { x: c.x, z: c.z, y: 0.6, w: 0.3, h: 0.24, tex: Spr.frame };
    this.spark = { x: this.x, z: this.z, y: this.y + this.sparkleH, w: 0.09, h: 0.09, tex: Spr.sparkle, blend: 'add', emissive: 1 };
    this.glint = { x: this.x, z: this.z, y: this.y + 0.5, r: 2.2, i: 0.8, c: [1, 0.95, 0.85], k: 0.5 };
  }
  prompt() { return '[E] - 조사하기'; }
  update() {
    const t = Time.time + this.seed, n = Math.pow(Math.abs(Math.sin(t * 0.9)), 12);
    this.spark.y = this.y + this.sparkleH + Math.sin(t * 1.7) * 0.05; const sc = (0.045 + n * 0.035) * 2; this.spark.w = this.spark.h = sc;
    this.spark.alpha = clamp01((2.5 + n * 5) / 5);
    if (!this.noticed && this.noticeDistance > 0 && !PlayerState.InputLocked) {
      const p = World.player; if (dist2(p.x, p.z, this.x, this.z) <= this.noticeDistance) {
        this.noticed = true;
        if (Time.time - clueNoticeTime >= 15 && !LoopUI.IsSpeaking) { clueNoticeTime = Time.time; LoopUI.Say('...저기, 뭔가 떨어져 있다.', 2); }
      }
    }
  }
  sprites(out) { out.push(this.sprite, this.spark); }
  lights(out) { out.push(this.glint); }
  interact() {
    const c = this.data;
    if (LoopManager.AddClue({ id: c.id, title: c.title, desc: c.desc, img: c.img })) {
      const text = LoopManager.AllCluesFound ? '...전부 기억났어. 집으로... 가야 해.' : c.after;
      LoopUI.OpenClue(LoopManager.foundClues[LoopManager.FoundCount - 1], text);
      this.active = false;
    }
  }
}

// ------------------------------------------------------------------ 카메라 줍기 (CameraPickup)
let cameraTaughtOnce = false;
class CameraPickup {
  constructor(x, z) {
    Object.assign(this, { x, z, id: 'camera', radius: 0.45, iy: 0.1, hr: 0.5 });
    this.active = LoopManager.CurrentLoop >= 6;
    this.sprite = { x, z, y: 0, w: 0.32, h: 0.24, tex: Spr.camera };
    this.spark = { x, z, y: 0.4, w: 0.1, h: 0.1, tex: Spr.sparkle, blend: 'add', emissive: 1 };
    this.glint = { x, z, y: 0.36, r: 2.2, i: 2.5, c: [1, 0.95, 0.85], k: 0.5 };
  }
  prompt() { return '[E] - 줍기'; }
  update() { const t = Time.time, n = Math.pow(Math.abs(Math.sin(t * 0.9)), 12); this.spark.y = 0.4 + Math.sin(t * 1.7) * 0.05; this.spark.w = this.spark.h = (0.045 + n * 0.035) * 2; }
  sprites(out) { out.push(this.sprite, this.spark); }
  lights(out) { out.push(this.glint); }
  interact() {
    FilmCamera.give(); LoopUI.Say('...카메라? 이게 왜 여기 있지.', 2);
    if (!cameraTaughtOnce) { cameraTaughtOnce = true; LoopUI.ShowTip(LoopUI.TipKey('G', '카메라 들기') + '        ' + LoopUI.TipKey('좌클릭', '찍기')); }
    this.active = false;
  }
}

// ------------------------------------------------------------------ 숨는 곳 (HidingLocker + HideSpotGlow)
const Hiding = { Occupied: null, all: [], onHid: [] };
class HidingLocker {
  constructor(name, x, z, yaw, kind) {
    Object.assign(this, { name, x, z, yaw, kind, id: 'hide:' + name, busy: false });
    this.radius = kind === 'dumpster' ? 0.95 : 0.6; this.hr = 1.2; this.iy = 0.8; this.solid = kind === 'dumpster' ? 0.8 : 0.45;
    const f = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
    this.out = f;
    this.sprite = kind === 'dumpster' ? { x, z, y: 0, w: 1.8, h: 1.3, tex: Spr.dumpster } : { x, z, y: 0, w: 0.9, h: 1.9, tex: Spr.cabinet };
    const loop = LoopManager.CurrentLoop; this.glowStrength = 1 - clamp01((loop - 1) / 5); // fadeOutLoop 6
    this.glowSpr = { x, z, y: -0.05, w: this.sprite.w + 0.16, h: this.sprite.h + 0.12, tex: Spr.glow, blend: 'add', emissive: 1, alpha: 0 };
    this.flicker = 1; this.flickerT = 0;
    Hiding.all.push(this);
  }
  get IsOccupied() { return Hiding.Occupied === this; }
  prompt() { return PlayerState.IsHidden ? '' : '[E] - 숨기'; }
  slitPoint(off = 0.3) { return { x: this.x + this.out[0] * (this.solid + off), z: this.z + this.out[1] * (this.solid + off) }; }
  update() {
    if (this.glowStrength > 0) {
      const p = World.player, inside = p && dist2(p.x, p.z, this.x, this.z) < this.solid + 0.6;
      this.flickerT -= Time.dt; if (this.flickerT <= 0) { this.flickerT = rand(0.05, 0.4); this.flicker = Math.random() < 0.08 ? rand(0.2, 0.6) : 1; }
      this.glowSpr.alpha = inside ? 0 : 0.5 * this.glowStrength * (0.6 + 0.4 * Math.sin(Time.time * 1.2 * Math.PI)) * this.flicker * 0.35;
    }
    if (this.IsOccupied && !this.busy && !PlayerState.Paused && Input.hit('KeyE') && !PlayerState.InputLocked) Co.start(this.exitRoutine());
  }
  sprites(out) { if (this.glowStrength > 0 && this.glowSpr.alpha > 0.01) out.push(this.glowSpr); out.push(this.sprite); }
  interact() { if (this.busy || PlayerState.IsHidden) return; Co.start(this.enterRoutine()); }
  *enterRoutine() {
    const p = World.player; this.busy = true;
    Audio.play(this.kind === 'dumpster' ? 'bin' : 'Metal_Cabinet', { vol: 0.8, emitter: { x: this.x, z: this.z }, min: 1, max: 20 });
    this.exitPos = [p.x, p.z]; this.exitYaw = p.yaw; this.exitEye = p.eyeY;
    p.movementLocked = true; p.noCollide = true;
    const sx = p.x, sz = p.z, sy = p.yaw, endYaw = this.yaw, camH = this.kind === 'dumpster' ? 1.05 : 1.45;
    for (let t = 0; t < 0.7;) {
      t += Time.dt; const k = smoothstep(0, 1, t / 0.7);
      p.x = lerp(sx, this.x, k); p.z = lerp(sz, this.z, k); p.yaw = sy + deltaAngle(sy, endYaw) * k; p.eyeY = lerp(this.exitEye, camH, k);
      yield;
    }
    Hiding.Occupied = this; PlayerState.IsHidden = true;
    for (const f of Hiding.onHid) f();
    this.busy = false;
  }
  *exitRoutine() {
    const p = World.player; this.busy = true;
    Audio.play(this.kind === 'dumpster' ? 'bin' : 'Metal_Cabinet', { vol: 0.8, emitter: { x: this.x, z: this.z }, min: 1, max: 20 });
    PlayerState.IsHidden = false;
    const sx = p.x, sz = p.z, se = p.eyeY;
    for (let t = 0; t < 0.56;) { t += Time.dt; const k = smoothstep(0, 1, t / 0.56); p.x = lerp(sx, this.exitPos[0], k); p.z = lerp(sz, this.exitPos[1], k); p.eyeY = lerp(se, this.exitEye, k); yield; }
    p.x = this.exitPos[0]; p.z = this.exitPos[1]; p.yaw = this.exitYaw; p.eyeY = this.exitEye;
    p.movementLocked = false; p.noCollide = false;
    if (Hiding.Occupied === this) Hiding.Occupied = null;
    this.busy = false;
  }
  forceOut() {
    if (!this.IsOccupied) return;
    const p = World.player;
    Audio.play(this.kind === 'dumpster' ? 'bin' : 'Metal_Cabinet', { vol: 0.8 });
    PlayerState.IsHidden = false;
    p.x = this.exitPos[0]; p.z = this.exitPos[1]; p.yaw = this.exitYaw; p.eyeY = this.exitEye;
    p.movementLocked = false; p.noCollide = false; Hiding.Occupied = null; this.busy = false;
  }
}
// 숨어 있을 때 보이는 틈새 (사물함 루버 / 쓰레기통 뚜껑 틈)
function drawHideOverlay() {
  const h = Hiding.Occupied; if (!h || !PlayerState.IsHidden) return;
  const g = UI.g, cw = UI.cw, ch = UI.ch;
  g.save(); g.fillStyle = 'rgb(6,6,7)';
  if (h.kind === 'dumpster') {
    g.fillRect(0, 0, cw, ch * 0.44); g.fillRect(0, ch * 0.56, cw, ch * 0.44);
    g.fillStyle = 'rgba(30,60,40,0.9)'; g.fillRect(0, ch * 0.44 - 6, cw, 6); g.fillRect(0, ch * 0.56, cw, 6);
  } else {
    g.fillRect(0, 0, cw, ch * 0.3); g.fillRect(0, ch * 0.62, cw, ch * 0.38); g.fillRect(0, 0, cw * 0.18, ch); g.fillRect(cw * 0.82, 0, cw * 0.18, ch);
    for (let i = 0; i < 6; i++) { const y = ch * (0.3 + i * 0.054); g.fillStyle = 'rgb(28,30,33)'; g.fillRect(cw * 0.18, y + ch * 0.026, cw * 0.64, ch * 0.03); }
  }
  g.restore();
  const vg = g.createRadialGradient(cw / 2, ch / 2, ch * 0.1, cw / 2, ch / 2, ch * 0.8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.8)');
  g.fillStyle = vg; g.fillRect(0, 0, cw, ch);
}

// ------------------------------------------------------------------ 수배 전단 (WantedPosterSpawner)
const POSTER_SLOTS = [[62.02, -89.11, 0.418, 0.908, 9], [60.84, -88.59, 0, 1, 6], [63.21, -90.49, 0.418, 0.908, 7], [85.28, -99.33, 0.957, -0.29, 7], [59.63, -88.09, 0, 1, 9], [80.19, -96.81, 0.924, -0.383, 6], [53.6, -87.59, 0, 1, 5], [77.05, -93.81, 0.924, -0.383, 7], [47.91, -87.1, 0.707, 0.707, 7], [-18.26, -92.23, 0, 1, 4], [52.1, -87.59, 0, 1, 8], [43.89, -86.9, -0.707, 0.707, 6], [46.18, -87.14, 0, 1, 9], [50.6, -87.59, 0, 1, 9], [-18.61, -93.5, -0.707, 0.707, 9], [64.23, -91.77, 0.418, 0.908, 8], [79.17, -95.01, 0.924, -0.383, 8], [87.79, -97.79, 0.882, 0.472, 6], [35.5, -86.79, 0, 1, 4], [41.85, -87.14, 0, 1, 8], [-16.44, -92.22, 0, 1, 8], [9.51, -85.5, 0.707, 0.707, 7], [56.5, -88.54, 0, 1, 9], [55.17, -88.54, 0, 1, 9], [39.51, -87.04, 0, 1, 9], [61.41, -90.53, 0.707, 0.707, 9], [-18.61, -94.9, -0.707, 0.707, 9], [38.1, -87.09, 0, 1, 9], [5.75, -85.76, 1, 0, 6], [4, -85.86, 1, 0, 8], [83.57, -98.07, 0.957, -0.29, 7], [27.79, -87.3, -0.707, 0.707, 9], [81.69, -96.82, 0.957, -0.29, 9], [-12.2, -92.29, 0, 1, 9], [32.4, -87.39, 0, 1, 9], [31, -87.39, 0, 1, 8], [34, -87.39, 0, 1, 9], [29.6, -87.39, 0, 1, 7], [65.62, -93.38, 0.418, 0.908, 9], [-10.75, -92.24, 0, 1, 7], [2.25, -85.76, 1, 0, 9], [47.91, -88.67, 0.707, 0.707, 9], [-0.5, -85.81, 1, 0, 9], [-2, -85.81, 1, 0, 5], [-3.5, -85.81, 1, 0, 8], [22.79, -88.3, -0.707, 0.707, 9], [61.41, -91.93, 0.707, 0.707, 9], [24.1, -88.39, 0, 1, 9], [74.6, -90.51, 0.924, -0.383, 9], [25.52, -88.39, 0, 1, 6], [-8, -92.91, 0, 1, 9], [18.6, -89.39, 0, 1, 5], [66.99, -94.99, 0.418, 0.908, 9], [72.99, -89.61, 0.924, -0.383, 9], [82.34, -95.65, 0.924, 0.383, 9], [-18.61, -97.9, -0.707, 0.707, 9], [-5.77, -92.91, 1, 0, 9], [20.1, -89.39, 0, 1, 8]];
class WantedPosters {
  constructor() {
    this.items = []; this.noticed = false;
    const loop = LoopManager.CurrentLoop, rnd = seeded(1234);
    const R = (a, b) => a + rnd() * (b - a);
    for (const [x, z, qy, qw, appear] of POSTER_SLOTS) {
      if (loop < appear) continue;
      const yaw = 2 * Math.atan2(qy, qw) / DEG; // 쿼터니언(y,w) → 각도
      const n = loop < 9 ? 1 : 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        let fx = Math.sin(yaw * DEG), fz = Math.cos(yaw * DEG), rx = Math.cos(yaw * DEG), rz = -Math.sin(yaw * DEG);
        let px = x, pz = z, py = 1.33;
        if (i > 0) { const k = R(-0.28, 0.28); px += rx * k; pz += rz * k; py += R(-0.2, 0.2); }
        // 벽 안쪽에 묻히지 않도록 열린 쪽으로 띄운다
        let side = 1;
        if (World.map && cellType(World.map, px + fx * 0.6, pz + fz * 0.6) && !cellType(World.map, px - fx * 0.6, pz - fz * 0.6)) side = -1;
        px += fx * 0.06 * side; pz += fz * 0.06 * side;
        const hw = 0.23;
        const s = { flat: { ax: px - rx * hw * side, az: pz - rz * hw * side, bx: px + rx * hw * side, bz: pz + rz * hw * side }, y: py - 0.0, h: 0.9, tex: Spr.poster, x: px, z: pz, nx: fx * side, nz: fz * side };
        this.items.push(s);
      }
    }
  }
  sprites(out) { for (const s of this.items) out.push(s); }
  update() {
    if (this.noticed || !this.items.length || PlayerState.InputLocked) return;
    const cam = World.camera(), [fx, fz] = World.player.forward();
    for (const s of this.items) {
      const vx = s.x - cam.x, vz = s.z - cam.z, d = Math.hypot(vx, vz); if (d > 3.5) continue;
      if ((fx * vx + fz * vz) / d < 0.75) continue;
      if ((s.nx * -vx + s.nz * -vz) / d < 0) continue;
      if (!LoopUI.IsSpeaking) { this.noticed = true; LoopUI.Say(this.pickLine(), 2.2); }
      break;
    }
  }
  pickLine() {
    const loop = LoopManager.CurrentLoop, remember = LoopManager.FoundCount >= loop - 2;
    if (loop >= 9) return remember ? '...전부 나를 보고 있어.' : '...전부 그 남자야. 빨리 잡혀야 할 텐데.';
    if (loop >= 7) return remember ? '...나도 저런 옷이 있는데.' : '...내가 말한 그 남자야.';
    if (loop >= 6) return '...검은색 상의.';
    return '...누가 얼굴만 찢어 놨네.';
  }
}

// ------------------------------------------------------------------ 가로등 (Night Lights)
class LampPosts {
  constructor(map) { this.map = map; this.items = map.lamps.filter(l => !l.home).map(l => ({ L: l, post: { x: l.x, z: l.z, y: 0, w: 0.24, h: l.y + 0.3, tex: Spr.lampPost }, head: { x: l.x, z: l.z, y: l.y - 0.25, w: 0.9, h: 0.45, tex: Spr.lampHead, blend: 'add', emissive: 1 } })); }
  sprites(out) { for (const it of this.items) { out.push(it.post); if (!it.L.off) out.push(it.head); } }
}

// ------------------------------------------------------------------ 집 현관 (HomeEntrance)
class HomeEntrance {
  constructor(x, z) { this.x = x; this.z = z; this.id = 'home'; this.door = { x, z, y: 0, w: 1.1, h: 2.2, tex: Tex.homeDoor }; }
  update() {
    const p = World.player; if (!p || TimeRewind.IsRewinding) return;
    if (dist2(p.x, p.z, this.x, this.z) < 1.3 && !QuizMan.HomeBlocked && !SeekGirl.BlocksHome) LoopFlow.EnterHome();
  }
  sprites(out) { out.push(this.door); }
}

// ------------------------------------------------------------------ 집 안 물건
class Bed {
  constructor() { Object.assign(this, { x: -1.73, z: 1.99, radius: 1.0, iy: 0.5, hr: 0.6, id: 'bed' }); }
  prompt() { return '[E] - 잠자기'; }
  interact() { if (!LoopFlow.EndingPlaying) LoopFlow.Sleep(); }
}
class MedicationPile {
  constructor() {
    const loop = LoopManager.CurrentLoop, n = loop < 6 ? (loop < 4 ? 9 : 6) : 3;
    const pos = [[2.04, 0.53], [2.15, 0.55], [2.06, 0.73], [2.19, 0.74], [2.06, 0.54], [2.15, 0.76], [2.18, 0.6], [2.04, 0.52], [2.16, 0.71]];
    this.items = pos.slice(0, n).map(([x, z], i) => ({ x, z, y: 0.69 + (i % 3) * 0.012, w: 0.16, h: 0.04, tex: Spr.meds }));
  }
  sprites(out) { for (const s of this.items) out.push(s); }
}
