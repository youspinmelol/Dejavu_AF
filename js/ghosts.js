// 귀신들: SeekGirl(딸, 2회차~), QuizMan(아버지, 4회차~), PhotophobiaGhost(어머니, 6회차~), JumpScare
'use strict';

// NavMeshAgent 대체: 격자 A* 경로를 따라 이동
class Agent {
  constructor(owner, speed) { this.o = owner; this.speed = speed; this.path = null; this.dest = null; this.isStopped = false; this.enabled = true; this.vel = 0; this.repath = 0; }
  setDestination(x, z) {
    const m = World.map;
    if (this.dest && dist2(this.dest[0], this.dest[1], x, z) < 0.8 && this.path && this.repath > 0) return;
    this.dest = [x, z]; this.repath = 0.6;
    this.path = lineClear(m, this.o.x, this.o.z, x, z, 0.15) ? [[x, z]] : (findPath(m, this.o.x, this.o.z, x, z) || [[x, z]]);
  }
  get remainingDistance() { if (!this.path || !this.path.length) return 0; let d = dist2(this.o.x, this.o.z, this.path[0][0], this.path[0][1]); for (let i = 1; i < this.path.length; i++) d += dist2(this.path[i - 1][0], this.path[i - 1][1], this.path[i][0], this.path[i][1]); return d; }
  warp(x, z) { this.o.x = x; this.o.z = z; this.path = null; this.dest = null; }
  update(dt) {
    this.repath -= dt; this.vel = 0;
    if (!this.enabled || this.isStopped || !this.path || !this.path.length) return;
    let step = this.speed * dt;
    while (step > 0 && this.path.length) {
      const [tx, tz] = this.path[0], d = dist2(this.o.x, this.o.z, tx, tz);
      if (d <= step) { this.o.x = tx; this.o.z = tz; step -= d; this.path.shift(); }
      else { this.o.x += (tx - this.o.x) / d * step; this.o.z += (tz - this.o.z) / d * step; this.o.yaw = lerpAngle(this.o.yaw, yawTo(0, 0, tx - this.o.x, tz - this.o.z), dt * 10); step = 0; }
    }
    this.vel = this.speed;
  }
}

// ================================================================== SeekGirl (숨바꼭질)
const SeekGirl = {
  BlocksHome: false, instance: null,
  sameSpot: { lastId: null, streak: 0, warned: false, lastLoop: -1 },
  get AnyEngaged() { const g = this.instance; return !!g && g.active && g.state !== 'Wander' && g.state !== 'Gone'; },
  clearSameSpot(loop) { Object.assign(this.sameSpot, { lastId: null, streak: 0, warned: false, lastLoop: loop }); },
  recordHideSpot(spot) {
    const S = this.sameSpot, loop = LoopManager.CurrentLoop;
    if (loop === S.lastLoop) return;
    if (loop < S.lastLoop) this.clearSameSpot(-1);
    S.lastLoop = loop;
    const id = spot ? spot.name : null;
    if (!id) { S.lastId = null; S.streak = 0; S.warned = false; }
    else if (id === S.lastId) S.streak++;
    else { S.lastId = id; S.streak = 1; S.warned = false; }
  }
};
class SeekGirlE {
  constructor(x, z) {
    Object.assign(this, { x, z, yaw: 90, id: 'girl', state: 'Wander', hidden: false });
    this.cfg = { wanderSpeed: 1.6, approachSpeed: 1.2, seekSpeed: 3.2, catchSpeed: 6, wanderInterval: 5, detectRange: 15, inviteDistance: 3.5, approachStopDistance: 1.8, viewDistance: 20, fov: 100, seekDuration: 25, checkLockerRange: 1.8, openChance: 0.5, biteDamage: 70, farTeleportDistance: 9, farTeleportArrive: 3.8, leadSpeed: 2.2, followDistance: 2.2, lineHold: 2.8, countHold: 0.8 };
    this.zone = { cx: -14.979, cz: -87.749, half: 0.48, margin: 3 };
    this.leadDest = [15.736, -81.946];
    this.speaker = '???';
    this.active = !(LoopManager.CurrentLoop < 2 || LoopManager.LostEndingPending);
    SeekGirl.instance = this;
    if (!this.active) { this.state = 'Gone'; return; }
    Hiding.Occupied = null;
    this.agent = new Agent(this, this.cfg.wanderSpeed);
    this.wanderTimer = 0; this.whisperTimer = 0; this.timer = 0; this.visited = new Set(); this.targetLocker = null; this.arriving = false;
    this.invited = false; this.peeked = false; this.forcedOpen = false; this.eyeLineSaid = false; this.dollDropped = false;
    this.stepTravel = 0; this.lastPos = [x, z]; this.laughTimer = rand(7, 13); this.lift = 0;
    this.spr = { x, z, y: 0, w: 0.75, h: 1.5, tex: Spr.girl };
    this.doll = null;
    this.hum = Audio.play('girl_humming', { cat: 'sfx', loop: true, vol: 0, emitter: () => this, min: 2, max: 22, offset: rand(0, 40) });
    Hiding.onHid.push(() => this.onPlayerHid());
  }
  sprites(out) {
    if (!this.active || this.hidden || this.state === 'Gone') return;
    const moving = this.agent && this.agent.vel > 0.2;
    this.spr.x = this.x; this.spr.z = this.z; this.spr.y = this.lift + (moving ? Math.abs(Math.sin(Time.time * 9)) * 0.03 : 0);
    this.spr.tex = this.dollDropped ? Spr.girlNoDoll : Spr.girl;
    out.push(this.spr);
    if (this.doll) out.push(this.doll);
  }
  get otherGhostBusy() { return PhotophobiaGhost.EncounterActive || QuizMan.Active; }
  update() {
    if (!this.active) return;
    SeekGirl.BlocksHome = this.state !== 'Gone';
    const dt = Time.dt;
    if (this.state !== 'Gone') this.sounds(dt);
    if (this.state === 'Gone' || this.state === 'Catch' || TimeRewind.IsRewinding) return;
    this.agent.update(dt);
    const p = World.player;
    if (this.otherGhostBusy && (this.state === 'Wander' || this.state === 'Lead' || this.state === 'Seek')) { if (this.state === 'Wander') this.tickWander(false); return; }
    if (!TimeRewind.IsRewinding && this.inHomeZone(p.x, p.z)) {
      if (this.state === 'Wander' && !PlayerState.InputLocked) { this.state = 'Lead'; Co.start(this.leadCutscene(), 'girl'); return; }
      if (this.state === 'Count' && !PlayerState.InputLocked) { Co.stopTag('girl'); Co.start(this.catchRunaway('2번은 없어.'), 'girl'); return; }
      if (this.state === 'Seek' && !PlayerState.InputLocked) { Co.stopTag('girl'); Co.start(this.catchRunaway('...반칙이야.'), 'girl'); return; }
    }
    if (this.state === 'Wander') this.tickWander(true);
    else if (this.state === 'Approach') this.tickApproach();
    else if (this.state === 'Seek') this.tickSeek(dt);
  }
  sounds(dt) {
    const d = dist2(this.x, this.z, this.lastPos[0], this.lastPos[1]); this.lastPos = [this.x, this.z];
    const sp = dt > 0 ? d / dt : 0;
    if (d < 2) this.stepTravel += d;
    if (this.stepTravel >= 0.55 * (sp > 4 ? 1.6 : 1)) { this.stepTravel = 0; Audio.play(SFX.footsteps[randInt(0, 6)], { vol: 0.7 * (sp > 4 ? 1.3 : 1), emitter: { x: this.x, z: this.z }, min: 1, max: 18 }); }
    if (this.hum) this.hum.setVol(this.state === 'Wander' && !TimeRewind.IsRewinding && !this.hidden ? moveTowards(this.hum.vol, 0.55, dt * 0.5) : 0);
    if (this.state === 'Seek') { this.laughTimer -= dt; if (this.laughTimer <= 0) { this.laughTimer = rand(7, 13); Audio.play(['girl_laugh1', 'girl_laugh2'][randInt(0, 2)], { vol: 0.8, emitter: { x: this.x, z: this.z }, min: 2, max: 25 }); } }
  }
  canSee(x, z, eyeH = 1.6) { return sightClear(World.map, this.x, this.z, x, z); }
  inFront(x, z) { return Math.abs(deltaAngle(this.yaw, yawTo(this.x, this.z, x, z))) <= this.cfg.fov / 2; }
  distP() { const p = World.player; return dist2(this.x, this.z, p.x, p.z); }
  homeDist(x, z) { const h = World.homeEntrance; return dist2(x, z, h.x, h.z); }
  inHomeZone(x, z) {
    const Z = this.zone, h = World.homeEntrance; if (!h) return false;
    let ax = 1; if ((h.x - Z.cx) * ax < 0) ax = -1;
    if ((x - Z.cx) * ax + Z.half >= 0) return this.homeDist(x, z) <= this.homeDist(Z.cx, Z.cz) + Z.margin;
    return false;
  }
  tickWander(mayNotice) {
    const p = World.player;
    if (mayNotice && !PlayerState.InputLocked && !PlayerState.IsHidden && this.distP() <= this.cfg.detectRange && this.canSee(p.x, p.z)) { this.enterApproach(); return; }
    const arrived = !this.agent.path || this.agent.remainingDistance <= 0.5;
    if (Time.time >= this.wanderTimer || arrived) {
      const pt = randomWalkable(World.map);
      if (pt) { this.agent.speed = this.cfg.wanderSpeed; this.agent.setDestination(pt[0], pt[1]); this.wanderTimer = Time.time + this.cfg.wanderInterval; }
    }
  }
  enterApproach() {
    LoopUI.ForceCloseClue();
    this.state = 'Approach'; const p = World.player;
    p.movementLocked = true; PlayerState.InputLocked = true;
    this.agent.speed = this.cfg.approachSpeed; this.invited = false;
    if (this.distP() > this.cfg.farTeleportDistance) this.teleportToFront();
    LoopUI.ClearSpeech(); LoopUI.Say('...찾았다.', this.cfg.lineHold, this.speaker, this);
  }
  teleportToFront() {
    const p = World.player, m = World.map, [fx, fz] = p.forward();
    const dirs = [[fx, fz], [(this.x - p.x), (this.z - p.z)]];
    for (const [dx0, dz0] of dirs) {
      const L = Math.hypot(dx0, dz0); if (L < 0.01) continue; const dx = dx0 / L, dz = dz0 / L;
      for (let d = this.cfg.farTeleportArrive; d >= 2.2; d -= 0.4) {
        const tx = p.x + dx * d, tz = p.z + dz * d;
        if (!cellType(m, tx, tz) && sightClear(m, p.x, p.z, tx, tz)) {
          this.agent.warp(tx, tz); this.yaw = yawTo(tx, tz, p.x, p.z); this.lastPos = [tx, tz];
          play2D(SFX.ghostWhoosh, 0.9); return;
        }
      }
    }
  }
  teleportInFront(d) {
    const p = World.player, [fx, fz] = p.forward(), m = World.map;
    let tx = p.x + fx * d, tz = p.z + fz * d;
    for (let k = d; k > 0.3; k -= 0.1) { if (lineClear(m, p.x, p.z, p.x + fx * k, p.z + fz * k)) { tx = p.x + fx * Math.max(0.5, k - 0.2); tz = p.z + fz * Math.max(0.5, k - 0.2); break; } }
    [tx, tz] = nearestWalkable(m, tx, tz);
    this.agent.warp(tx, tz); this.yaw = yawTo(tx, tz, p.x, p.z); this.lastPos = [tx, tz];
    play2D('ghost_whoosh', 0.8);
  }
  lookAtGirl(k) {
    const p = World.player; p.yaw = lerpAngle(p.yaw, yawTo(p.x, p.z, this.x, this.z), clamp01(k));
    const d = this.distP(), headY = 1.1 + this.lift, pitch = clamp(-Math.atan2(headY - p.eyeY, Math.max(0.1, d)) / DEG, -40, 40);
    p.pitch = lerp(p.pitch, pitch, clamp01(k));
  }
  *turnPlayerToGirl(time) { for (let t = 0; t < time; t += Time.dt) { this.lookAtGirl(Time.dt / Math.max(0.01, time - t)); yield; } this.lookAtGirl(1); }
  *leadCutscene() {
    const ui = LoopUI, p = World.player;
    ui.ForceCloseClue(); ui.ClearSpeech();
    p.movementLocked = true; PlayerState.InputLocked = true; p.enabled = false;
    this.teleportInFront(2.6); this.agent.isStopped = true;
    yield* this.turnPlayerToGirl(0.35);
    ui.Say('어디 가? ...아직 안 놀았잖아.', 1.6, this.speaker, this);
    ui.Say('일단 따라와.', 1.2, this.speaker, this);
    yield* ui.WaitForSpeech();
    const goal = nearestWalkable(World.map, this.leadDest[0], this.leadDest[1]);
    const [fx, fz] = p.forward(), rx = fz, rz = -fx;
    const sgn = (rx * (goal[0] - p.x) + rz * (goal[1] - p.z)) >= 0 ? 1 : -1;
    let bypass = nearestWalkable(World.map, p.x + rx * 1.3 * sgn - fx * 0.4, p.z + rz * 1.3 * sgn - fz * 0.4);
    this.agent.speed = this.cfg.leadSpeed; this.agent.isStopped = false; this.agent.setDestination(bypass[0], bypass[1]);
    let second = false, leg = 0; const trail = []; let step = 0;
    p.noCollide = true;
    for (let t = 0; t < 90; t += Time.dt) {
      leg += Time.dt;
      this.agent.update(0); // 위치 유지용
      if (!second && (dist2(this.x, this.z, bypass[0], bypass[1]) < 0.6 || leg > 2.5)) { second = true; this.agent.repath = 0; this.agent.setDestination(goal[0], goal[1]); trail.push([this.x, this.z]); }
      if (second && this.agent.remainingDistance <= 0.6) break;
      if (second && dist2(this.x, this.z, trail[trail.length - 1][0], trail[trail.length - 1][1]) > 0.25) trail.push([this.x, this.z]);
      const d = this.distP();
      this.agent.isStopped = second && d > this.cfg.followDistance + 4;
      this.agent.update(Time.dt);
      if (second && d > this.cfg.followDistance && trail.length) {
        let mv = this.cfg.leadSpeed * 1.1 * Time.dt;
        while (mv > 1e-4 && trail.length) {
          const vx = trail[0][0] - p.x, vz = trail[0][1] - p.z, L = Math.hypot(vx, vz), s = Math.min(L, mv);
          if (s > 1e-4) { p.x += vx / L * s; p.z += vz / L * s; }
          mv -= s; step += s;
          if (!(dist2(p.x, p.z, trail[0][0], trail[0][1]) < 0.05) || trail.length <= 1) break;
          trail.shift();
        }
        if (step >= 0.62) { step = 0; p.playFootstep(0.8); }
      }
      this.lookAtGirl(Time.dt * 4);
      yield;
    }
    p.noCollide = false; this.agent.isStopped = true;
    this.yaw = yawTo(this.x, this.z, p.x, p.z);
    yield* this.turnPlayerToGirl(0.4);
    ui.Say('여기서 하자.', this.cfg.lineHold, this.speaker, this);
    yield* this.countRoutine();
  }
  *catchRunaway(line) {
    if (Hiding.Occupied) Hiding.Occupied.forceOut();
    this.agent.isStopped = false; this.teleportInFront(1.4);
    yield* this.biteRoutine(line);
  }
  tickApproach() {
    const p = World.player;
    this.agent.setDestination(p.x, p.z);
    if (!this.invited && this.distP() <= this.cfg.inviteDistance) { this.invited = true; LoopUI.Say('우리... 숨바꼭질 하자.', this.cfg.lineHold, this.speaker, this); }
    p.yaw = lerpAngle(p.yaw, yawTo(p.x, p.z, this.x, this.z), Time.dt * 1.5);
    if (this.distP() <= this.cfg.approachStopDistance) { this.state = 'Count'; Co.start(this.countRoutine(), 'girl'); }
  }
  *countRoutine() {
    this.state = 'Count'; this.agent.isStopped = true;
    const ui = LoopUI, p = World.player;
    yield* ui.WaitForSpeech();
    ui.Say('내가 술래. 열까지 셀게.', this.cfg.lineHold, this.speaker, this);
    const S = SeekGirl.sameSpot;
    if (LoopManager.CurrentLoop < S.lastLoop) SeekGirl.clearSameSpot(-1);
    if (S.streak >= 3 && !S.warned) { S.warned = true; ui.Say('이번엔 다른 곳에 숨어봐, 같은 곳에 숨지 말고', this.cfg.lineHold, this.speaker, this); }
    yield* ui.WaitForSpeech();
    p.enabled = true; p.movementLocked = false; PlayerState.InputLocked = false;
    ui.Say('...숨어야 해.', 1.8);
    this.yaw = yawTo(this.x, this.z, p.x, p.z);
    yield* ui.WaitForSpeech();
    for (const w of ['하나...', '둘...', '셋...', '넷...', '다섯...', '여섯...', '일곱...', '여덟...', '아홉...', '열.']) ui.Say(w, this.cfg.countHold, this.speaker, this);
    yield* ui.WaitForSpeech();
    this.enterSeek();
  }
  enterSeek() {
    this.state = 'Seek'; this.timer = this.cfg.seekDuration; this.whisperTimer = rand(5, 8); this.eyeLineSaid = false;
    this.agent.isStopped = false; this.agent.speed = this.cfg.seekSpeed; this.visited.clear(); this.targetLocker = null; this.arriving = false;
    LoopUI.Say('...이제 찾는다?', this.cfg.lineHold, this.speaker, this);
  }
  canSeePlayer() {
    const p = World.player; if (PlayerState.IsHidden) return false;
    if (this.distP() > this.cfg.viewDistance || !this.inFront(p.x, p.z)) return false;
    return this.canSee(p.x, p.z);
  }
  tickSeek(dt) {
    this.timer -= dt;
    if (this.timer <= 0 && !this.forcedOpen) { this.state = 'Catch'; Co.start(this.surviveRoutine(), 'girl'); return; }
    if (this.canSeePlayer()) { Co.start(this.biteRoutine(), 'girl'); return; }
    const occ = Hiding.Occupied, S = SeekGirl.sameSpot;
    if (!this.forcedOpen && S.warned && occ && occ.name === S.lastId) {
      this.forcedOpen = true; this.targetLocker = occ; this.agent.speed = this.cfg.seekSpeed * 1.3; this.agent.setDestination(occ.x, occ.z); this.arriving = true;
    }
    if (this.forcedOpen) {
      if (!this.targetLocker || !this.targetLocker.IsOccupied) { this.forcedOpen = false; this.agent.speed = this.cfg.seekSpeed; this.targetLocker = null; this.arriving = false; }
      else { this.agent.setDestination(this.targetLocker.x, this.targetLocker.z); if (dist2(this.x, this.z, this.targetLocker.x, this.targetLocker.z) <= this.cfg.checkLockerRange + this.targetLocker.solid) { SeekGirl.clearSameSpot(LoopManager.CurrentLoop); Co.start(this.biteRoutine(), 'girl'); } }
      return;
    }
    this.whisperTimer -= dt;
    if (this.whisperTimer <= 0 && !LoopUI.IsSpeaking) {
      const loop = LoopManager.CurrentLoop;
      if (!this.eyeLineSaid && loop >= 7 && loop <= 9) { this.eyeLineSaid = true; LoopUI.Say('아저씨가 내 눈을 팠잖아... 그래서 인형 눈을 빌렸는데, 잃어버렸어.', this.cfg.lineHold + 0.6, this.speaker, this); }
      else LoopUI.Say(['어디 있어...?', '거기 있지?', '숨소리 들려...', '금방 찾을 거야.'][randInt(0, 4)], 2.2, this.speaker, this);
      this.whisperTimer = rand(6, 9);
    }
    if (LoopManager.CurrentLoop === 5 && !this.peeked && occ && this.timer < this.cfg.seekDuration - 5 && this.targetLocker !== occ) {
      this.targetLocker = occ; this.agent.setDestination(occ.x, occ.z); this.arriving = true;
    }
    if (!this.targetLocker) {
      const list = Hiding.all.filter(h => !this.visited.has(h));
      if (!list.length) { this.visited.clear(); return; }
      list.sort((a, b) => dist2(this.x, this.z, a.x, a.z) - dist2(this.x, this.z, b.x, b.z));
      this.targetLocker = list[randInt(0, Math.min(3, list.length))];
      const sp = this.targetLocker.slitPoint(0.5); this.agent.setDestination(sp[0] ?? sp.x, sp.z); this.arriving = true;
    }
    if (this.arriving && dist2(this.x, this.z, this.targetLocker.x, this.targetLocker.z) <= this.cfg.checkLockerRange + this.targetLocker.solid) {
      this.arriving = false; const L = this.targetLocker; this.visited.add(L);
      if (L.IsOccupied && LoopManager.CurrentLoop === 5 && !this.peeked && JumpScare.TryUse('locker', 5)) Co.start(this.peekRoutine(L), 'girl');
      else if (L.IsOccupied && Math.random() < this.cfg.openChance) Co.start(this.biteRoutine(), 'girl');
      else this.targetLocker = null;
    } else if (this.arriving && this.targetLocker && this.agent.remainingDistance < 0.3) {
      const sp = this.targetLocker.slitPoint(0.5); this.agent.setDestination(sp.x, sp.z);
    }
  }
  onPlayerHid() {
    if (this.state !== 'Seek' || !Hiding.Occupied) return;
    const h = Hiding.Occupied;
    if (this.canSee(h.x, h.z) && this.inFront(h.x, h.z) && dist2(this.x, this.z, h.x, h.z) <= this.cfg.viewDistance) Co.start(this.biteRoutine(), 'girl');
  }
  *biteRoutine(line = null) {
    if (this.state === 'Catch' && this.biting) return; if (this.state === 'Gone') return;
    this.biting = true;
    SeekGirl.recordHideSpot(Hiding.Occupied);
    this.state = 'Catch';
    LoopUI.ForceCloseClue(); const ui = LoopUI, p = World.player;
    ui.ClearSpeech(); ui.Say(line || '찾았다.', 1.5, this.speaker, this);
    this.agent.isStopped = false; this.agent.speed = this.cfg.catchSpeed;
    for (let t = 0; t < 1.2; t += Time.dt) {
      const tgt = Hiding.Occupied || p;
      if (dist2(this.x, this.z, tgt.x, tgt.z) <= 1.4 + (Hiding.Occupied ? Hiding.Occupied.solid : 0)) break;
      this.agent.setDestination(tgt.x, tgt.z); this.agent.update(Time.dt); yield;
    }
    if (Hiding.Occupied) Hiding.Occupied.forceOut();
    p.movementLocked = true; PlayerState.InputLocked = true; this.agent.enabled = false;
    const [fx, fz] = p.forward();
    this.x = p.x + fx * 1.1; this.z = p.z + fz * 1.1; this.yaw = yawTo(this.x, this.z, p.x, p.z);
    yield;
    const lookPitch = -Math.atan2(1.4 - p.eyeY, 1.1) / DEG;
    yield* this.rotateCam(0.2, p.pitch, lookPitch, 0);
    yield 0.6;
    this.dropDoll();
    // 물기 애니메이션 (Zombie_neck_bite 0.5→0.75 다가옴, 0.75→1.0 머리 뻗기, 1.0 물기, 2.6 놓기)
    const fromX = this.x, fromZ = this.z, toX = p.x + fx * 1.0, toZ = p.z + fz * 1.0;
    for (let t = 0; t < 0.25; t += Time.dt) { const k = smoothstep(0, 1, t / 0.25); this.x = lerp(fromX, toX, k); this.z = lerp(fromZ, toZ, k); this.lift = 0.3 * k; yield; }
    let pitch = lookPitch;
    for (let t = 0; t < 0.25; t += Time.dt) { const k = smoothstep(0, 1, t / 0.25); this.x = lerp(toX, p.x + fx * 0.55, k); this.z = lerp(toZ, p.z + fz * 0.55, k); pitch = lerp(pitch, -10, Time.dt * 14); p.pitch = pitch; p.roll = lerp(0, -25, k); yield; }
    play2D('bite_flesh'); p.takeDamage(this.cfg.biteDamage);
    for (let t = 0; t < 1.6; t += Time.dt) {
      const n = 1 - t / 1.6 * 0.6;
      Render.post.shakeX = rand(-1, 1) * 0.01 * n; Render.post.shakeY = rand(-1, 1) * 0.01 * n;
      p.pitch = pitch + rand(-3, 3) * n; p.roll = -25 + rand(-4, 4) * n; yield;
    }
    Render.post.shakeX = Render.post.shakeY = 0;
    play2D('ghost_whoosh', 0.7);
    yield* Fader.fade(1, 0.08);
    this.hidden = true; p.roll = 0;
    if (p.IsAlive) {
      p.movementLocked = false; PlayerState.InputLocked = false;
      Fader.start(0, 0.8); ui.Say('...크윽.', 2.2);
    }
    this.vanish();
  }
  *rotateCam(dur, from, to, toRoll) { const p = World.player, fr = p.roll; for (let t = 0; t < dur; t += Time.dt) { const k = smoothstep(0, 1, t / dur); p.pitch = lerp(from, to, k); p.roll = lerp(fr, toRoll, k); yield; } p.pitch = to; p.roll = toRoll; }
  dropDoll() {
    if (this.dollDropped) return; this.dollDropped = true;
    const d = { x: this.x + rand(-0.2, 0.2), z: this.z + rand(-0.2, 0.2), y: 0.6, w: 0.3, h: 0.32, tex: Spr.paper };
    d.tex = paint(32, 32, (g) => { g.fillStyle = '#b8aea0'; g.beginPath(); g.ellipse(16, 20, 10, 9, 0.4, 0, 7); g.fill(); g.beginPath(); g.ellipse(9, 12, 6, 6, 0, 0, 7); g.fill(); });
    this.doll = d;
    Co.start((function* () { let vy = 0.4; for (let b = 0; b < 2;) { vy -= 9.81 * Time.dt; d.y += vy * Time.dt; if (d.y <= 0.02 && vy < 0) { d.y = 0.02; vy = -vy * 0.25; b++; } yield; } d.y = 0.02; })());
  }
  *peekRoutine(locker) {
    // 5회차: 숨은 곳 틈새로 얼굴이 들여다본다
    this.peeked = true; this.state = 'Catch'; this.agent.isStopped = true;
    const p = World.player;
    if (!locker.IsOccupied) { this.resumeSeek(); return; }
    const outYaw = locker.yaw, fromYaw = p.yaw, fromPitch = p.pitch;
    for (let t = 0; t < 0.35; t += Time.dt) { const k = smoothstep(0, 1, t / 0.35); p.yaw = fromYaw + deltaAngle(fromYaw, outYaw) * k; p.pitch = lerp(fromPitch, 0, k); yield; }
    this.hidden = true;
    yield 3;
    if (!locker.IsOccupied) { this.hidden = false; this.resumeSeek(); return; }
    playLoud('jumpscare_sound2');
    const F = FX.face; F.img = null; F.tilt = 42;
    for (let t = 0; t < 0.12; t += Time.dt) { F.alpha = 1; F.x = lerp(1.35, 0.78, t / 0.12); F.y = 0.5; F.scale = 0.75; yield; }
    F.x = 0.78;
    LoopUI.ClearSpeech(); LoopUI.Say('흐음... 여기 있나..?', 2, this.speaker, this);
    yield* LoopUI.WaitForSpeech(); yield 0.3;
    for (let t = 0; t < 0.35; t += Time.dt) { F.x = lerp(0.78, 1.35, smoothstep(0, 1, t / 0.35)); yield; }
    F.alpha = 0; F.tilt = 0; F.x = 0.5;
    const sp = locker.slitPoint(1.2); [this.x, this.z] = nearestWalkable(World.map, sp.x + locker.out[1] * 1.0, sp.z - locker.out[0] * 1.0);
    this.hidden = false; this.agent.enabled = true; this.resumeSeek();
  }
  resumeSeek() { this.state = 'Seek'; this.agent.isStopped = false; this.targetLocker = null; this.arriving = false; this.timer = Math.min(this.timer, 10); }
  *surviveRoutine() {
    SeekGirl.recordHideSpot(Hiding.Occupied);
    this.state = 'Catch'; this.agent.isStopped = true;
    LoopUI.ClearSpeech(); LoopUI.Say('...오늘은 못 찾았네.', this.cfg.lineHold, this.speaker, this); LoopUI.Say('나중에 봐.', this.cfg.lineHold, this.speaker, this);
    yield* LoopUI.WaitForSpeech();
    play2D('ghost_whoosh'); yield* Fader.fade(1, 0.08);
    this.hidden = true; Fader.start(0, 0.5); this.vanish();
  }
  vanish() { this.state = 'Gone'; this.doll = null; if (this.hum) this.hum.setVol(0); SeekGirl.BlocksHome = false; }
  track() { return { x: this.x, z: this.z, active: this.state !== 'Gone' && !this.hidden }; }
  applyTrack(s) { this.x = s.x; this.z = s.z; this.hidden = !s.active; }
}

// ================================================================== QuizMan (아버지: 집 앞 퀴즈)
const QuizMan = { HomeBlocked: false, Active: false };
const QUIZ = [
  { text: '우리 딸이 숨바꼭질에서 가장 싫어한 반칙은?', choices: ['숨바꼭질 도중 도망치기', '눈 뜨고 세기', '숨는 곳 바꾸기'], answer: 0 },
  { text: '딸의 인형 눈은 무엇으로 달려 있었지?', choices: ['빨간색, 파란색 단추', '유리구슬', '빨간 실'], answer: 0 },
  { text: '그날 밤, 우리 집에 온 손님은 누구였지?', choices: ['우체부', '도끼를 든 남자', '옆집 사람'], answer: 1 },
  { text: '딸이 아끼던 머리핀은 무슨 모양이었지?', choices: ['나비', '별', '딸기'], answer: 2 },
  { text: '내 아내가 가장 무서워한 소리는?', choices: ['천둥소리', '셔터 소리', '초인종'], answer: 1 },
  { text: '그날 밤, 우리 집에 오기 전에 어디에 들렀지?', choices: ['약국', '편의점', '철물점'], answer: 2 },
];
const QUIZ_FINAL = { text: '마지막 문제다. 누가 그랬지?', choices: ['모르는 사람', '아무도 아니다', '나'], answer: 2 };
class QuizManE {
  constructor(x, z) {
    Object.assign(this, { x, z, id: 'quiz', minLoop: 4, triggerDistance: 11, visible: false, started: false, speaker: '???' });
    QuizMan.HomeBlocked = false; QuizMan.Active = false;
    this.active = !(LoopManager.CurrentLoop < this.minLoop || LoopManager.LostEndingPending);
    if (!this.active) return;
    QuizMan.HomeBlocked = true;
    this.spr = { x, z, y: 0, w: 0.85, h: 1.85, tex: Spr.father };
    this.lamp = World.map.lamps.find(l => l.home);
  }
  get hidden() { return !this.visible; }
  sprites(out) { if (this.active && this.visible) { this.spr.x = this.x; this.spr.z = this.z; out.push(this.spr); } }
  setLights(on) { if (this.lamp) { this.lamp.off = !on; World.map.needRebuild = true; } }
  update() {
    if (!this.active || this.started || TimeRewind.IsRewinding) return;
    const p = World.player;
    if (!PlayerState.InputLocked && !SeekGirl.AnyEngaged && !PhotophobiaGhost.EncounterActive && dist2(p.x, p.z, this.x, this.z) <= this.triggerDistance) Co.start(this.encounter(), 'quiz');
  }
  *encounter() {
    this.started = true; QuizMan.Active = true;
    const p = World.player, ui = LoopUI;
    p.movementLocked = true; PlayerState.InputLocked = true; ui.ClearSpeech();
    play2D('ghost_whoosh');
    for (let i = 0; i < 7; i++) { this.setLights(i % 2 === 1); if (i === 4) this.visible = true; yield rand(0.06, 0.2); }
    this.setLights(true);
    const from = p.yaw, to = yawTo(p.x, p.z, this.x, this.z);
    for (let t = 0; t < 0.6; t += Time.dt) { p.yaw = from + deltaAngle(from, to) * smoothstep(0, 1, t / 0.6); yield; }
    if (LoopManager.CurrentLoop === this.minLoop) ui.Say('...왔구나. 늘 이 시간에 왔었지.', 2.5, this.speaker, this);
    ui.Say('문제 하나 내볼까.', 1.5, this.speaker, this);
    yield* ui.WaitForSpeech();
    const final = LoopManager.IsFinalLoop && !LoopManager.AllCluesFound;
    const index = Math.max(0, LoopManager.CurrentLoop - this.minLoop);
    let wrong = 0;
    for (; ;) {
      const q = final ? QUIZ_FINAL : QUIZ[(index + wrong) % QUIZ.length];
      const order = [0, 1, 2]; for (let n = 2; n > 0; n--) { const k = randInt(0, n + 1);[order[n], order[k]] = [order[k], order[n]]; }
      const picked = yield* ui.Ask(q.text, order.map(i => q.choices[i]), this.speaker, this);
      if (order[picked] === q.answer) {
        if (final) ui.Say('...이제야 기억났구나.', 2.5, this.speaker, this);
        else { ui.Say('맞다.', 1, this.speaker, this); ui.Say('...그런데 넌 그걸 어떻게 알고 있지?', 2.5, this.speaker, this); }
        yield* ui.WaitForSpeech();
        if (!final && LoopManager.CurrentLoop === 8 && JumpScare.TryUse('quiz', 8)) yield* this.rushFace();
        yield* this.vanish();
        if (!final) ui.Say('...내가 그걸 어떻게 알았지.');
        QuizMan.HomeBlocked = false; QuizMan.Active = false; p.movementLocked = false; PlayerState.InputLocked = false;
        return;
      }
      wrong++;
      const rushed = wrong === 1 && LoopManager.CurrentLoop === 8 && JumpScare.TryUse('quiz', 8);
      if (rushed) yield* this.rushFace(); else play2D('horror_hit_low');
      p.takeDamage(35);
      if (!p.IsAlive) return;
      if (wrong >= 3) break;
      if (!rushed) { ui.Say('틀렸다. ...잊은 척하지 마.', 1.8, this.speaker, this); yield* ui.WaitForSpeech(); }
    }
    ui.Say('...넌 끝까지 모르는 척하는구나.', 2.5, this.speaker, this);
    yield* ui.WaitForSpeech();
    p.takeDamage(9999);
  }
  *rushFace() {
    const p = World.player, hx = this.x, hz = this.z, [fx, fz] = p.forward();
    const tx = p.x + fx * 0.45, tz = p.z + fz * 0.45;
    for (let t = 0; t < 0.1; t += Time.dt) { this.x = lerp(hx, tx, t / 0.1); this.z = lerp(hz, tz, t / 0.1); yield; }
    this.x = tx; this.z = tz;
    yield* JumpScare.ScreamStretched(['#WHY_Father'], this.speaker);
    this.x = hx; this.z = hz; this.setLights(false);
    yield real(0.9);
    Fader.start(0, 0.05);
    for (let i = 0; i < 4; i++) { this.setLights(i % 2 === 1); yield rand(0.05, 0.15); }
    this.setLights(true);
  }
  *vanish() { for (let i = 0; i < 5; i++) { this.setLights(i % 2 === 1); if (i === 2) this.visible = false; yield rand(0.05, 0.15); } this.setLights(true); }
  track() { return { x: this.x, z: this.z, active: this.visible }; }
  applyTrack(s) { this.x = s.x; this.z = s.z; this.visible = s.active; }
}

// ================================================================== PhotophobiaGhost (어머니: 빛 공포증)
const PhotophobiaGhost = { EncounterActive: false };
class PhotophobiaE {
  constructor(x, z) {
    Object.assign(this, { x, z, id: 'photo', minLoop: 6, state: 'Dormant', visible: false, speaker: '???' });
    PhotophobiaGhost.EncounterActive = false;
    this.active = !(LoopManager.CurrentLoop < this.minLoop || LoopManager.LostEndingPending);
    if (!this.active) return;
    this.cfg = { zoneStart: 0.03, zoneEnd: 0.45, rest: 4, linger: 20, spawnMin: 14, spawnMax: 20, aheadChance: 0.6, revealTime: 1.3, rushSpeed: 9, giveUp: 12, grab: 1.3, damage: 45, lightOffRadius: 22 };
    this.remaining = randInt(2, 4);
    const n = this.remaining, step = (this.cfg.zoneEnd - this.cfg.zoneStart) / Math.max(1, n);
    this.triggers = Array.from({ length: n }, (_, i) => this.cfg.zoneStart + step * (i + rand(0.25, 0.85)));
    this.nextTrigger = 0; this.rest = 0; this.lingerTimer = 0; this.photographed = false;
    this.spr = { x, z, y: 0, w: 0.8, h: 1.75, tex: Spr.mother, emissive: 0.85 };
    this.aura = { x, z, y: 2.8, r: 5, i: 0, c: [0.75, 0.82, 1], k: 0.5 };
    this.flash = { x, z, y: 1.8, r: 14, i: 0, c: [1, 0.97, 0.92], k: 0.3 };
    this.dimmed = [];
    // 역 출구 → 집 경로
    const h = World.homeEntrance, s = window.STREET_MAP.stairDest;
    this.route = findPath(World.map, s[0], s[2], h.x, h.z) || [[s[0], s[2]], [h.x, h.z]];
    this.route.unshift([s[0], s[2]]);
    this.routeDist = [0]; for (let i = 1; i < this.route.length; i++) this.routeDist[i] = this.routeDist[i - 1] + dist2(...this.route[i - 1], ...this.route[i]);
  }
  get hidden() { return !this.visible; }
  get routeLength() { return this.routeDist[this.routeDist.length - 1] || 0; }
  photoPoint() { return { x: this.x, y: 1.3, z: this.z }; }
  onPhotographed() { if (this.state === 'Reveal' || this.state === 'Rush') this.photographed = true; }
  sprites(out) { if (this.visible) { this.spr.x = this.x; this.spr.z = this.z; out.push(this.spr); } }
  lights(out) { this.aura.x = this.x; this.aura.z = this.z; out.push(this.aura, this.flash); }
  along(px, pz) {
    let best = 1e9, res = 0;
    for (let i = 1; i < this.route.length; i++) {
      const [ax, az] = this.route[i - 1], [bx, bz] = this.route[i], ex = bx - ax, ez = bz - az, L2 = Math.max(1e-4, ex * ex + ez * ez);
      const t = clamp01(((px - ax) * ex + (pz - az) * ez) / L2), d = dist2(px, pz, ax + ex * t, az + ez * t);
      if (d < best) { best = d; res = this.routeDist[i - 1] + Math.sqrt(L2) * t; }
    }
    return res;
  }
  pointAlong(a) {
    a = clamp(a, 0, this.routeLength);
    for (let i = 1; i < this.route.length; i++) if (this.routeDist[i] >= a) { const k = (a - this.routeDist[i - 1]) / Math.max(1e-4, this.routeDist[i] - this.routeDist[i - 1]); return [lerp(this.route[i - 1][0], this.route[i][0], k), lerp(this.route[i - 1][1], this.route[i][1], k)]; }
    return this.route[this.route.length - 1];
  }
  update() {
    if (!this.active) return;
    if (this.visible) { const n = Math.random() < 0.08 ? rand(0.1, 0.5) : 1; this.aura.i = 3 * n * (0.85 + perlin(Time.time * 6) * 0.3); }
    if (this.state !== 'Dormant' || this.remaining <= 0 || PlayerState.InputLocked || PlayerState.IsHidden || TimeRewind.IsRewinding || QuizMan.Active || SeekGirl.AnyEngaged) return;
    if (this.rest > 0) { this.rest -= Time.dt; return; }
    const p = World.player, a = this.along(p.x, p.z), f = a / Math.max(1, this.routeLength);
    if (f > this.cfg.zoneEnd + 0.15) { this.nextTrigger = this.triggers.length; return; }
    const inZone = f >= this.cfg.zoneStart && f <= this.cfg.zoneEnd;
    if (inZone) this.lingerTimer += Time.dt;
    const trig = this.nextTrigger < this.triggers.length && f >= this.triggers[this.nextTrigger];
    const linger = inZone && this.lingerTimer >= this.cfg.linger;
    if (!trig && !linger) return;
    const sp = this.pickSpawn(a);
    if (sp) { if (trig) this.nextTrigger++; this.lingerTimer = 0; Co.start(this.encounter(sp), 'photo'); }
    else this.rest = 1;
  }
  pickSpawn(a) {
    const p = World.player;
    for (let i = 0; i < 6; i++) {
      const d = rand(this.cfg.spawnMin, this.cfg.spawnMax), ahead = Math.random() < this.cfg.aheadChance;
      let [x, z] = this.pointAlong(a + (ahead ? d : -d)); [x, z] = nearestWalkable(World.map, x, z);
      if (dist2(x, z, p.x, p.z) >= 10 && sightClear(World.map, p.x, p.z, x, z)) return [x, z];
    }
    return null;
  }
  *encounter([sx, sz]) {
    this.state = 'Reveal'; PhotophobiaGhost.EncounterActive = true; this.photographed = false;
    const ui = LoopUI, p = World.player;
    ui.ForceCloseClue();
    Audio.play(Proc.shutter, { vol: 1, emitter: { x: sx, z: sz }, min: 6, max: 45 });
    Co.start(this.spawnFlash(sx, sz), 'photo');
    yield* this.flickerOff(p.x, p.z);
    this.x = sx; this.z = sz; this.visible = true; FilmCamera.targets.add(this);
    const behind = Math.abs(deltaAngle(p.yaw, yawTo(p.x, p.z, sx, sz))) > 100;
    if (behind) ui.Say('...뒤에, 뭔가 있어.', 1.2);
    ui.Say(['...거기 있었구나.', '그 카메라... 이리 줘.'][randInt(0, 2)], 1.5, this.speaker, this);
    const wait = behind ? this.cfg.revealTime + 0.8 : 0;
    for (let t = 0; t < wait; t += Time.dt) { if (this.photographed) break; yield; }
    let result = 'giveup';
    if (!this.photographed) {
      this.state = 'Rush'; Audio.play('horror_hit_low', { emitter: { x: this.x, z: this.z }, min: 3, max: 40 });
      for (let t = 0; t < this.cfg.giveUp; t += Time.dt) {
        if (this.photographed) { result = 'photo'; break; }
        if (PlayerState.IsHidden) { result = 'lost'; break; }
        const vx = p.x - this.x, vz = p.z - this.z, L = Math.hypot(vx, vz), s = Math.min(L, this.cfg.rushSpeed * Time.dt);
        if (L > 1e-4) { this.x += vx / L * s; this.z += vz / L * s; }
        if (dist2(this.x, this.z, p.x, p.z) <= this.cfg.grab) { result = 'grab'; break; }
        yield;
      }
    } else result = 'photo';
    FilmCamera.targets.delete(this);
    if (result === 'photo') {
      Audio.play('horror_hit_low', { emitter: { x: this.x, z: this.z }, min: 3, max: 40 });
      for (let t = 0; t < 0.35; t += Time.dt) { const n = 1 - t / 0.35; this.spr.emissive = lerp(0.85, 4, n); this.spr.w = 0.8 * (1 + (1 - n) * 0.15); yield; }
      this.spr.emissive = 0.85; this.spr.w = 0.8;
      ui.Say('찍지... 마...', 1.5, this.speaker, this);
    } else if (result === 'grab') yield* this.grab();
    this.aura.i = 0; this.visible = false;
    yield* this.flickerOn();
    this.remaining--; this.rest = this.cfg.rest; this.lingerTimer = 0; this.state = 'Dormant'; PhotophobiaGhost.EncounterActive = false;
  }
  *spawnFlash(x, z) { this.flash.x = x; this.flash.z = z; for (let t = 0; t < 0.3; t += Time.dt) { const n = 1 - t / 0.3; this.flash.i = 18 * n * n; yield; } this.flash.i = 0; }
  *flickerOff(cx, cz) {
    const m = World.map; this.dimmed = m.lamps.filter(l => !l.off && dist2(l.x, l.z, cx, cz) <= this.cfg.lightOffRadius);
    for (let j = 0; j < 6; j++) { for (const l of this.dimmed) l.off = j % 2 === 0; m.needRebuild = true; yield rand(0.05, 0.18); }
    for (const l of this.dimmed) l.off = true; m.needRebuild = true;
  }
  *flickerOn() { const m = World.map; for (let i = 0; i < 4; i++) { for (const l of this.dimmed) l.off = i % 2 !== 0; m.needRebuild = true; yield rand(0.05, 0.15); } this.restoreLights(); }
  restoreLights() { for (const l of this.dimmed) l.off = false; this.dimmed = []; if (World.map) World.map.needRebuild = true; }
  *grab() {
    play2D('bite_flesh');
    const p = World.player; p.movementLocked = true; p.takeDamage(this.cfg.damage);
    LoopUI.Say('다시는... 못 찍게 해줄게.', 1.5, this.speaker, this);
    for (let t = 0; t < 0.6; t += Time.dt) { const n = 1 - t / 0.6; Render.post.shakeX = rand(-1, 1) * 0.012 * n; Render.post.shakeY = rand(-1, 1) * 0.012 * n; yield; }
    Render.post.shakeX = Render.post.shakeY = 0;
    if (p.IsAlive) p.movementLocked = false;
  }
  track() { return { x: this.x, z: this.z, active: this.visible }; }
  applyTrack(s) { this.x = s.x; this.z = s.z; this.visible = s.active; }
}

// ================================================================== JumpScare
const JumpScare = {
  done: new Set(), doneLoop: -1, Busy: false, alley: null, alleySearch: 0,
  TryUse(key, loop) {
    if (Settings.MildMode || LoopManager.LostEndingPending || LoopManager.CurrentLoop !== loop) return false;
    if (this.doneLoop !== LoopManager.CurrentLoop) { this.done.clear(); this.doneLoop = LoopManager.CurrentLoop; }
    if (this.done.has(key)) return false; this.done.add(key); return true;
  },
  // 4회차: 단서 화면을 닫으면 소녀 얼굴이 눈앞에
  onClueClosed(journal) { if (!journal && LoopManager.CurrentLoop === 4 && this.TryUse('clue', 4)) Co.start(this.clueFace(), 'global'); },
  *clueFace() {
    const p = World.player; if (!p) return;
    this.Busy = true; const wl = p.movementLocked, wi = PlayerState.InputLocked; p.movementLocked = true; PlayerState.InputLocked = true;
    playLoud('jumpscare_sound2');
    const F = FX.face; F.img = null; F.x = 0.5; F.y = 0.52; F.tilt = 0;
    for (let t = 0; t < 0.55; t += Time.dt) { F.alpha = 1; F.scale = 1.05 + Math.random() * 0.02; Render.post.shakeX = rand(-1, 1) * 0.006 * (1 - t / 0.55); yield; }
    Render.post.shakeX = 0;
    yield* Fader.fade(1, 0.06); F.alpha = 0;
    yield 0.15;
    p.movementLocked = wl; PlayerState.InputLocked = wi; this.Busy = false;
    yield* Fader.fade(0, 0.3);
  },
  // 2회차: 지하철 맞은편에 소녀
  *subwayGirl(scene) {
    if (!this.TryUse('subway', 2)) return;
    const m = World.map, p = World.player;
    this.Busy = true;
    setTrainLights(m, false, 'car'); yield* Fader.fade(0.92, 0.05); yield 0.55;
    const [fx, fz] = p.forward();
    const girl = { x: p.x + fx * 1.25, z: p.z + fz * 1.25, y: 0, w: 0.75, h: 1.5, tex: Spr.girlNoDoll };
    scene.extraSprites.push(girl);
    setTrainLights(m, true, 'car'); yield* Fader.fade(0, 0.04);
    playLoud('jumpscare_sound1');
    yield 1.6;
    for (let j = 0; j < 3; j++) {
      setTrainLights(m, false, 'car'); Fader.start(0.85, 0.03); yield rand(0.06, 0.14);
      if (j === 1) scene.extraSprites.splice(scene.extraSprites.indexOf(girl), 1);
      setTrainLights(m, true, 'car'); Fader.start(0, 0.03); yield rand(0.05, 0.12);
    }
    this.Busy = false;
  },
  // 7회차: 골목 끝 검은 형체가 바라보면 달려든다
  tickAlley(scene) {
    if (LoopManager.CurrentLoop !== 7 || LoopManager.EndingPending || !World.isStreet()) { this.alley = null; return; }
    if ((this.doneLoop === 7 && this.done.has('alley')) || TimeRewind.IsRewinding) return;
    if (!this.alley) this.alley = { x: -4, z: -91, y: 0, w: 0.85, h: 1.85, tex: Spr.silhouette };
    if (this.Busy || PlayerState.InputLocked || PlayerState.IsHidden || PlayerState.Paused) return;
    const cam = World.camera(), a = this.alley, d = dist2(cam.x, cam.z, a.x, a.z);
    if (d > 13) return;
    const ang = Math.abs(deltaAngle(cam.yaw, yawTo(cam.x, cam.z, a.x, a.z)));
    if (d > 4 && ang > 28) return;
    if (!sightClear(World.map, cam.x, cam.z, a.x, a.z)) return;
    if (this.TryUse('alley', 7)) Co.start(this.alleyRush(), 'scene');
  },
  *alleyRush() {
    this.Busy = true; const a = this.alley, p = World.player;
    playLoud('jumpscare_sound1');
    const fx0 = a.x, fz0 = a.z;
    for (let t = 0; t < 0.16; t += Time.dt) { const [fx, fz] = p.forward(); a.x = lerp(fx0, p.x + fx * 0.75, t / 0.16); a.z = lerp(fz0, p.z + fz * 0.75, t / 0.16); yield; }
    for (let t = 0; t < 0.45; t += Time.dt) { const [fx, fz] = p.forward(); a.x = p.x + fx * 0.75; a.z = p.z + fz * 0.75; Render.post.shakeX = rand(-1, 1) * 0.005; yield; }
    Render.post.shakeX = 0;
    yield* Fader.fade(1, 0.04); this.alley = null;
    yield 0.08; this.Busy = false; yield* Fader.fade(0, 0.25);
  },
  // "어째서" 비명 (3회차 되감기 / 8회차 퀴즈맨)
  *ScreamStretched(keys, speaker, noiseFx = null) {
    const ui = LoopUI;
    const clips = keys.map(k => Audio.voice(k)).filter(Boolean);
    const plays = clips.map(c => Audio.playStretched(c, 3.6, 0.3, { cat: 'jumpscare', vol: clips.length > 1 ? 0.75 : 1 }));
    const voiceTime = plays.length ? Math.max(...plays.map(p => p.head)) : 1.2;
    const stretchTime = 3.6;
    ui.ClearSpeech(); ui.Say('어째서', voiceTime, speaker);
    FX.Glitch(voiceTime + stretchTime + 1);
    sting(0.8);
    const p = World.player;
    for (let t = 0; t < voiceTime; t += Time.udt) { const n = 1 - t / voiceTime * 0.5; if (noiseFx) noiseFx(rand(0.3, 0.9) * n); Render.post.shakeX = rand(-1, 1) * 0.012 * n; Render.post.shakeY = rand(-1, 1) * 0.012 * n; yield; }
    ui.ClearSpeech();
    const full = '어째서어어어어어어어어어어어어어'; let next = 0;
    for (let t = 0; t < stretchTime; t += Time.udt) {
      const k = t / stretchTime, len = clamp(3 + Math.floor(k * (full.length - 3)), 3, full.length);
      if (t >= next) { next = t + 0.3; ui.ClearSpeech(); ui.Say(corrupt(full.slice(0, len), 0.15 + k * 0.3), stretchTime, speaker); }
      if (noiseFx) noiseFx(rand(0.1, 0.5) * (1 - k * 0.5));
      Render.post.shakeX = rand(-1, 1) * 0.004 * (1 - k); yield;
    }
    for (const pl of plays) pl.stop();
    FX.StopGlitch(); ui.ClearSpeech(); Render.post.shakeX = Render.post.shakeY = 0;
    yield* Fader.fade(1, 0);
  }
};
