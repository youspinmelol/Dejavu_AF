// 레이캐스팅 렌더러 (Canvas 2D 픽셀 버퍼). 원본 URP 3D 렌더링을 대체한다.
'use strict';

const Render = {
  W: 480, H: 270, canvas: null, ctx: null, low: null, lctx: null, img: null, buf: null, depth: null,
  vfov: 60, // Unity 기본 카메라 수직 FOV
  post: { sat: 1, tint: [1, 1, 1], contrast: 1, flash: 0, noise: 0, bands: 0, chroma: 0, roll: 0, shakeX: 0, shakeY: 0, darkness: 0 },
  grain: null,
  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.low = makeCanvas(this.W, this.H); this.lctx = this.low.getContext('2d');
    const gc = makeCanvas(256, 256), g = gc.getContext('2d'), id = g.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0); this.grain = gc;
    this.applyQuality();
  },
  applyQuality() {
    if (!this.canvas) return;
    const q = Settings.Quality, H = [180, 225, 270][q] || 270;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const W = Math.round(H * aspect);
    if (W === this.W && H === this.H && this.img) return;
    this.W = W; this.H = H; this.low.width = W; this.low.height = H;
    this.img = this.lctx.createImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer); this.depth = new Float32Array(W * H);
  },

  // cam: {x,z,y(eye),yaw,pitch,fov}; map: Maps.*; sprites: []
  draw(cam, map, sprites) {
    const W = this.W, H = this.H, buf = this.buf, depth = this.depth;
    const vfov = (cam.fov || this.vfov) * DEG, tanV = Math.tan(vfov / 2), tanH = tanV * (W / H), proj = (H / 2) / tanV;
    const yaw = cam.yaw * DEG, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const horizon = H / 2 - Math.tan(clamp(cam.pitch, -85, 85) * DEG) * proj;
    const eyeY = cam.y, px = cam.x, pz = cam.z;
    const res = map.res, x0 = map.x0, z1 = map.z1, mw = map.w, mh = map.h, cells = map.cells, types = map.types;
    const light = map.light, amb = map.ambient, fog = map.fog, fogD = map.fogDensity * (map.fogMul || 1);
    const bright = Settings.Brightness * (map.exposure || 1) * (1 - this.post.darkness);
    const P = this.post, sat = P.sat, tr = P.tint[0], tg = P.tint[1], tb = P.tint[2], con = P.contrast, flash = P.flash;
    const fogR = fog[0], fogG = fog[1], fogB = fog[2];
    const ceilH = map.ceil ? map.ceil.h : 0;
    const maxDist = map.maxDist || 60;

    // 픽셀 색 계산 (빛·안개·후처리)
    const shade = (r, g, b, lr, lg, lb, d, idx, dep) => {
      r *= lr * bright; g *= lg * bright; b *= lb * bright;
      const f = 1 - Math.exp(-d * fogD);
      r += (fogR - r) * f; g += (fogG - g) * f; b += (fogB - b) * f;
      if (sat !== 1) { const L = r * 0.3 + g * 0.59 + b * 0.11; r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat; }
      if (con !== 1) { r = (r - 110) * con + 110; g = (g - 110) * con + 110; b = (b - 110) * con + 110; }
      r = r * tr + flash; g = g * tg + flash; b = b * tb + flash;
      buf[idx] = 0xff000000 | (b < 0 ? 0 : b > 255 ? 255 : b | 0) << 16 | (g < 0 ? 0 : g > 255 ? 255 : g | 0) << 8 | (r < 0 ? 0 : r > 255 ? 255 : r | 0);
      depth[idx] = dep;
    };
    const lightAt = (x, z, out) => {
      let gx = (x - x0) / res - 0.5, gy = (z1 - z) / res - 0.5;
      let i = gx | 0, j = gy | 0; if (gx < 0) i = -1; if (gy < 0) j = -1;
      const fx_ = gx - i, fy_ = gy - j;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < 4; k++) {
        const ii = i + (k & 1), jj = j + (k >> 1);
        const w = ((k & 1) ? fx_ : 1 - fx_) * ((k >> 1) ? fy_ : 1 - fy_);
        if (ii >= 0 && jj >= 0 && ii < mw && jj < mh) { const o = (jj * mw + ii) * 3; r += light[o] * w; g += light[o + 1] * w; b += light[o + 2] * w; }
      }
      out[0] = r + amb[0]; out[1] = g + amb[1]; out[2] = b + amb[2];
    };
    const L = [0, 0, 0];

    // ---- 바닥 / 천장 / 하늘
    const rayLX = fx - rx * tanH, rayLZ = fz - rz * tanH, rayRX = fx + rx * tanH, rayRZ = fz + rz * tanH;
    const ftexOf = map.floorTex, fcells = map.floorCells;
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - horizon;
      let rowDist, isFloor = dy > 0;
      if (isFloor) rowDist = eyeY * proj / dy;
      else if (map.ceil) rowDist = (ceilH - eyeY) * proj / -dy;
      else {
        // 하늘
        for (let x = 0; x < W; x++) {
          const idx = y * W + x; const c = map.skyColor(-dy / proj, x / W);
          buf[idx] = c; depth[idx] = 1e9;
        }
        continue;
      }
      if (rowDist > maxDist * 1.5) {
        for (let x = 0; x < W; x++) shade(0, 0, 0, 0, 0, 0, 1e4, y * W + x, rowDist);
        continue;
      }
      let wx = px + rayLX * rowDist, wz = pz + rayLZ * rowDist;
      const sx = (rayRX - rayLX) * rowDist / W, sz = (rayRZ - rayLZ) * rowDist / W;
      const ctex = map.ceil ? map.ceil.tex : null;
      const rd = rowDist; // 수직 거리 → 실제 거리 근사
      for (let x = 0; x < W; x++, wx += sx, wz += sz) {
        const idx = y * W + x;
        let tex;
        if (isFloor) {
          const ci = ((wx - x0) / res) | 0, cj = ((z1 - wz) / res) | 0;
          tex = (ci >= 0 && cj >= 0 && ci < mw && cj < mh) ? ftexOf[fcells[cj * mw + ci]] : ftexOf[0];
        } else {
          if (map.ceilTex) { const ci = ((wx - x0) / res) | 0, cj = ((z1 - wz) / res) | 0; tex = (ci >= 0 && cj >= 0 && ci < mw && cj < mh) ? map.ceilTex[fcells[cj * mw + ci]] : ctex; } else tex = ctex;
        }
        const tsc = tex.scale || 1;
        let u = (wx / tsc) % 1, v = (wz / tsc) % 1; if (u < 0) u += 1; if (v < 0) v += 1;
        const o = (((v * tex.h) | 0) * tex.w + ((u * tex.w) | 0)) * 4, d = tex.d;
        lightAt(wx, wz, L);
        if (!isFloor && map.ceilLight) { L[0] = L[1] = L[2] = map.ceilLight; }
        shade(d[o], d[o + 1], d[o + 2], L[0], L[1], L[2], rd, idx, rd);
      }
    }

    // ---- 벽 (레이마다 여러 높이의 벽을 모아 먼 것부터 그림)
    const hits = [];
    for (let c = 0; c < W; c++) {
      const camX = 2 * (c + 0.5) / W - 1;
      const dx = fx + rx * camX * tanH, dz = fz + rz * camX * tanH;
      let gx = (px - x0) / res, gy = (z1 - pz) / res;
      let mi = Math.floor(gx), mj = Math.floor(gy);
      const gdx = dx / res, gdy = -dz / res;
      const ddx = gdx === 0 ? 1e30 : Math.abs(1 / gdx), ddy = gdy === 0 ? 1e30 : Math.abs(1 / gdy);
      let stepX, stepY, sdx, sdy;
      if (gdx < 0) { stepX = -1; sdx = (gx - mi) * ddx; } else { stepX = 1; sdx = (mi + 1 - gx) * ddx; }
      if (gdy < 0) { stepY = -1; sdy = (gy - mj) * ddy; } else { stepY = 1; sdy = (mj + 1 - gy) * ddy; }
      hits.length = 0;
      let side = 0, t = 0, prevType = (mi >= 0 && mj >= 0 && mi < mw && mj < mh) ? cells[mj * mw + mi] : 0;
      let guard = 0;
      while (t < maxDist && guard++ < 600) {
        if (sdx < sdy) { t = sdx; sdx += ddx; mi += stepX; side = 0; } else { t = sdy; sdy += ddy; mj += stepY; side = 1; }
        let type;
        if (mi < 0 || mj < 0 || mi >= mw || mj >= mh) type = map.outside;
        else type = cells[mj * mw + mi];
        if (type && type === prevType && hits.length && hits[hits.length - 5] === type) hits[hits.length - 1] = Math.min(sdx, sdy); // 같은 낮은 벽이 이어지면 윗면을 끝까지
        if (type && type !== prevType) {
          const T = types[type];
          const tExit = Math.min(sdx, sdy);
          hits.push(t, type, side, mi, mj, tExit);
          if (T.h >= (map.ceil ? ceilH : 3.0) && !T.see) break;
          if (mi < 0 || mj < 0 || mi >= mw || mj >= mh) break;
        }
        prevType = type;
      }
      // 먼 것부터
      for (let k = hits.length - 6; k >= 0; k -= 6) {
        const ht = Math.max(0.02, hits[k]), type = hits[k + 1], sd = hits[k + 2], tExit = hits[k + 5];
        const T = types[type];
        const hx = px + dx * ht, hz = pz + dz * ht;
        let u = sd === 0 ? hz : hx;
        if ((sd === 0 && dx > 0) || (sd === 1 && dz < 0)) u = -u;
        const wallH = T.h, base = T.base || 0;
        let yTop = horizon - (wallH - eyeY) * proj / ht, yBot = horizon - (base - eyeY) * proj / ht;
        const y0 = Math.max(0, Math.ceil(yTop - 0.5)), y1 = Math.min(H - 1, Math.floor(yBot - 0.5));
        lightAt(hx - dx * 0.08, hz - dz * 0.08, L);
        if (T.emit) { L[0] = L[1] = L[2] = T.emit; }
        const sideDim = sd === 1 ? 0.82 : 1;
        const texs = T.texs, tex = texs ? texs[hash2(hits[k + 3] >> 3, hits[k + 4] >> 3) * texs.length | 0] : T.tex;
        const su = T.su || 1, sv = T.sv || wallH;
        let uu = (u / su) % 1; if (uu < 0) uu += 1;
        const tx = (uu * tex.w) | 0;
        for (let y = y0; y <= y1; y++) {
          const idx = y * W + c;
          const wy = eyeY - (y + 0.5 - horizon) * ht / proj; // 월드 높이
          let r, g, b;
          if (T.dyn) { const col = T.dyn(uu, wy, hx, hz); r = col[0]; g = col[1]; b = col[2]; }
          else {
            let vv = 1 - ((wy - base) / sv) % 1; if (vv >= 1) vv -= 1; if (vv < 0) vv += 1;
            const o = (((vv * tex.h) | 0) * tex.w + tx) * 4; r = tex.d[o]; g = tex.d[o + 1]; b = tex.d[o + 2];
          }
          shade(r * sideDim, g * sideDim, b * sideDim, L[0], L[1], L[2], ht, idx, ht);
        }
        // 낮은 벽의 윗면
        if (eyeY > wallH && T.cap) {
          const yTopFar = horizon - (wallH - eyeY) * proj / Math.max(ht + 0.01, tExit);
          const a0 = Math.max(0, Math.ceil(yTopFar - 0.5)), a1 = Math.min(H - 1, y0 - 1);
          const ct = T.cap, co = ((ct.h >> 1) * ct.w + (ct.w >> 1)) * 4;
          for (let y = a0; y <= a1; y++) shade(ct.d[co], ct.d[co + 1], ct.d[co + 2], L[0], L[1], L[2], ht, y * W + c, ht);
        }
      }
    }

    // ---- 스프라이트 (빌보드, 깊이 테스트)
    if (sprites && sprites.length) {
      const list = [];
      for (const s of sprites) {
        if (!s || s.hidden || !s.tex) continue;
        if (s.flat) { this.drawFlat(s, px, pz, fx, fz, rx, rz, tanH, proj, horizon, eyeY, shade, lightAt, L); continue; }
        const dx = s.x - px, dz = s.z - pz;
        const dep = dx * fx + dz * fz; if (dep < 0.08 || dep > maxDist) continue;
        list.push([dep, s, dx * rx + dz * rz]);
      }
      list.sort((a, b) => b[0] - a[0]);
      for (const [dep, s, lat] of list) {
        const tex = s.tex, sw = s.w * proj / dep, sh = s.h * proj / dep;
        const scx = W / 2 + (lat / dep) / tanH * (W / 2);
        const top = horizon - ((s.y || 0) + s.h - eyeY) * proj / dep;
        const xa = Math.max(0, Math.floor(scx - sw / 2)), xb = Math.min(W - 1, Math.ceil(scx + sw / 2));
        const ya = Math.max(0, Math.floor(top)), yb = Math.min(H - 1, Math.ceil(top + sh));
        if (xa > xb || ya > yb) continue;
        if (s.emissive) { L[0] = L[1] = L[2] = s.emissive; } else { lightAt(s.x, s.z, L); }
        const add = s.blend === 'add', alpha = s.alpha ?? 1, flip = s.flip;
        const tint = s.tint || null;
        for (let x = xa; x <= xb; x++) {
          let u = (x + 0.5 - (scx - sw / 2)) / sw; if (u < 0 || u >= 1) continue; if (flip) u = 1 - u;
          const tx = (u * tex.w) | 0;
          for (let y = ya; y <= yb; y++) {
            const idx = y * W + x; if (depth[idx] < dep) continue;
            const v = (y + 0.5 - top) / sh; if (v < 0 || v >= 1) continue;
            const o = (((v * tex.h) | 0) * tex.w + tx) * 4, a = tex.d[o + 3] / 255 * alpha;
            if (a < 0.03) continue;
            let r = tex.d[o], g = tex.d[o + 1], b = tex.d[o + 2];
            if (tint) { r *= tint[0]; g *= tint[1]; b *= tint[2]; }
            const old = buf[idx];
            if (add) {
              const f = 1 - Math.exp(-dep * fogD) * 0;
              r = (old & 255) + r * a * (1 - f * 0); g = ((old >> 8) & 255) + g * a; b = ((old >> 16) & 255) + b * a;
              buf[idx] = 0xff000000 | (b > 255 ? 255 : b | 0) << 16 | (g > 255 ? 255 : g | 0) << 8 | (r > 255 ? 255 : r | 0);
              continue;
            }
            if (a >= 0.98) { shade(r, g, b, L[0], L[1], L[2], dep, idx, dep); continue; }
            const or = old & 255, og = (old >> 8) & 255, ob = (old >> 16) & 255, od = depth[idx];
            shade(r, g, b, L[0], L[1], L[2], dep, idx, dep);
            const nw = buf[idx];
            r = or + ((nw & 255) - or) * a; g = og + (((nw >> 8) & 255) - og) * a; b = ob + (((nw >> 16) & 255) - ob) * a;
            buf[idx] = 0xff000000 | (b | 0) << 16 | (g | 0) << 8 | (r | 0); depth[idx] = od;
          }
        }
      }
    }
    this.lctx.putImageData(this.img, 0, 0);
  },
  // 벽에 붙은 평면 (수배 전단 등): 선분 A-B, 바닥에서 y ~ y+h
  drawFlat(s, px, pz, fx, fz, rx, rz, tanH, proj, horizon, eyeY, shade, lightAt, L) {
    const W = this.W, H = this.H, depth = this.depth, buf = this.buf, tex = s.tex, f = s.flat;
    const ex = f.bx - f.ax, ez = f.bz - f.az;
    // 뒷면이면 그리지 않음
    const nx = -ez, nz = ex; if ((px - f.ax) * nx + (pz - f.az) * nz < 0 && !s.twoSided) return;
    lightAt((f.ax + f.bx) / 2, (f.az + f.bz) / 2, L);
    for (let c = 0; c < W; c++) {
      const camX = 2 * (c + 0.5) / W - 1, dx = fx + rx * camX * tanH, dz = fz + rz * camX * tanH;
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-6) continue;
      const qx = f.ax - px, qz = f.az - pz;
      const t = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den;
      if (t < 0.05 || u < 0 || u > 1) continue;
      const top = horizon - (s.y + s.h - eyeY) * proj / t, bot = horizon - (s.y - eyeY) * proj / t;
      const ya = Math.max(0, Math.floor(top)), yb = Math.min(H - 1, Math.ceil(bot));
      const tx = (u * tex.w) | 0;
      for (let y = ya; y <= yb; y++) {
        const idx = y * W + c; if (depth[idx] < t - 0.02) continue;
        const v = (y + 0.5 - top) / (bot - top); if (v < 0 || v >= 1) continue;
        const o = (((v * tex.h) | 0) * tex.w + tx) * 4; if (tex.d[o + 3] < 128) continue;
        shade(tex.d[o], tex.d[o + 1], tex.d[o + 2], L[0], L[1], L[2], t, idx, t - 0.03);
      }
    }
  },

  // 저해상도 화면을 실제 캔버스에 (흔들림/기울기/번짐/노이즈 포함)
  present() {
    const g = this.ctx, cw = this.canvas.width, ch = this.canvas.height, P = this.post;
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    g.translate(cw / 2 + P.shakeX * cw, ch / 2 + P.shakeY * ch);
    if (P.roll) g.rotate(P.roll * DEG);
    const sc = P.roll ? 1 + Math.abs(Math.sin(P.roll * DEG)) * 0.8 : 1;
    g.scale(sc, sc);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.low, -cw / 2, -ch / 2, cw, ch);
    if (P.chroma > 0) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25 * P.chroma;
      const o = P.chroma * cw * 0.006;
      g.drawImage(this.low, -cw / 2 - o, -ch / 2, cw, ch); g.drawImage(this.low, -cw / 2 + o, -ch / 2, cw, ch);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    // 비네트 (NightHorrorProfile Vignette)
    const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = vg; g.fillRect(0, 0, cw, ch);
    // 필름 그레인
    const grain = 0.05 + P.noise;
    this.drawNoise(g, cw, ch, grain);
  },
  drawNoise(g, cw, ch, alpha) {
    if (alpha <= 0) return;
    g.save(); g.globalAlpha = clamp01(alpha); g.globalCompositeOperation = alpha > 0.2 ? 'source-over' : 'overlay';
    const pat = g.createPattern(this.grain, 'repeat');
    g.translate(-Math.random() * 256, -Math.random() * 256); g.scale(2, 2);
    g.fillStyle = pat; g.fillRect(0, 0, cw / 2 + 256, ch / 2 + 256);
    g.restore();
  }
};
