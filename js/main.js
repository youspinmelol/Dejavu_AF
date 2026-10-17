// 메인 루프
'use strict';

const Game = {
  canvas: null, last: 0, ready: false,
  inGameplay() { const s = Scenes.current; return !!s && (s.name === 'OutSide' || s.name === 'Home') && !!World.player; },
  wantsPointerLock() { return this.inGameplay() && !PlayerState.Paused; },
  lockPointer() { if (this.wantsPointerLock() && this.canvas.requestPointerLock && document.pointerLockElement !== this.canvas) { try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } } },
  onPointerUnlock() { if (this.inGameplay() && !Pause.open && Pause.canPause()) Pause.Open(); },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(innerWidth * dpr); this.canvas.height = Math.round(innerHeight * dpr);
    Render.applyQuality();
  },
  async start() {
    this.canvas = document.getElementById('game');
    Render.init(this.canvas); this.resize(); addEventListener('resize', () => this.resize());
    Input.init(this.canvas);
    buildTextures(); buildSprites();
    await loadImages();
    try { await document.fonts.load(`600 32px ${FONT}`); } catch (e) { }
    document.getElementById('loading').remove();
    Scenes.load('Lobby');
    this.ready = true;
    requestAnimationFrame(t => { this.last = t; this.frame(t); });
  },
  frame(ts) {
    const udt = Math.min(0.1, Math.max(0, (ts - this.last) / 1000)); this.last = ts;
    Time.udt = udt; Time.dt = udt * Time.scale; Time.time += Time.dt; Time.unscaledTime += udt; Time.frame++;
    try { this.update(); this.draw(); } catch (e) { console.error(e); }
    Input.endFrame();
    requestAnimationFrame(t => this.frame(t));
  },
  update() {
    const s = Scenes.current;
    LoopUI.update();
    if (this.inGameplay()) Pause.update();
    const p = World.player;
    if (p && this.inGameplay() && !PlayerState.Paused) {
      if (!TimeRewind.IsRewinding) p.update();
      Interactor.update();
      if (!TimeRewind.IsRewinding) for (const e of World.entities) if (e.update && e.active !== false) e.update();
      FilmCamera.update();
    } else if (!this.inGameplay()) LoopUI.HidePrompt();
    if (s && s.update) s.update();
    TimeRewind.update();
    Co.update();
    if (p) { const c = World.camera(); Audio.update({ x: c.x, z: c.z, yaw: c.yaw }); } else Audio.update();
    if (this.inGameplay() && !PlayerState.Paused && !Input.locked && Input.mousePressed) this.lockPointer();
  },
  draw() {
    const s = Scenes.current, g = Render.ctx, cw = this.canvas.width, ch = this.canvas.height;
    UI.begin(g, cw, ch);
    const m = World.map, p = World.player;
    if (m && p) {
      const cam = World.camera();
      // 움직이는 빛 모으기
      m.dyn.length = 0;
      for (const e of World.entities) if (e.lights && e.active !== false) e.lights(m.dyn);
      if (s.extraLights) m.dyn.push(...s.extraLights);
      if (World.flashLight > 0) m.dyn.push({ x: cam.x, z: cam.z, y: cam.y, r: 25, i: 25 * World.flashLight, c: [1, 0.97, 0.92], k: 0.12 });
      if (s.name === 'OutSide' && m.name === 'street' && s.policeLights) m.dyn.push(...s.policeLights);
      updateDynLights(m);
      const spr = [];
      for (const e of World.entities) if (e.sprites && e.active !== false) e.sprites(spr);
      spr.push(...s.extraSprites); if (s.sprites) s.sprites(spr);
      Render.post.roll = cam.roll || 0;
      Render.draw(cam, m, spr);
      Render.present();
      HomeMarker.draw(cam);
      drawHideOverlay();
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch); }
    if (s && s.draw) s.draw();
    FilmCamera.draw();
    FX.draw();
    UI.fill('#000', Fader.alpha);
    LoopUI.draw();
    drawEndingTitle();
    Pause.draw();
  }
};
window.addEventListener('load', () => Game.start());
