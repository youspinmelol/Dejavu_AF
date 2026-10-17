// 맵: 거리(OutSide 내비메시), 지하철 칸 + 승강장(OutSide 역 구역), 집(Home 씬)
'use strict';

const Maps = {};
const packRGB = (r, g, b) => 0xff000000 | (clamp(b, 0, 255) | 0) << 16 | (clamp(g, 0, 255) | 0) << 8 | (clamp(r, 0, 255) | 0);

function newMap(o) {
  const m = Object.assign({ types: [{ h: 0 }], ambient: [0.05, 0.05, 0.06], fog: [6, 7, 10], fogDensity: 0.06, lamps: [], dyn: [], outside: 1, maxDist: 60 }, o);
  m.cells = new Uint8Array(m.w * m.h); m.floorCells = new Uint8Array(m.w * m.h);
  m.base = new Float32Array(m.w * m.h * 3); m.light = new Float32Array(m.w * m.h * 3);
  m.dirty = null;
  return m;
}
function cellOf(m, x, z) { return [Math.floor((x - m.x0) / m.res), Math.floor((m.z1 - z) / m.res)]; }
function cellType(m, x, z) { const [i, j] = cellOf(m, x, z); if (i < 0 || j < 0 || i >= m.w || j >= m.h) return m.outside; return m.cells[j * m.w + i]; }
function fillRect(m, xa, xb, za, zb, type, floor) {
  const [i0, j1] = cellOf(m, xa, za), [i1, j0] = cellOf(m, xb - 1e-6, zb - 1e-6);
  for (let j = Math.max(0, j0); j <= Math.min(m.h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(m.w - 1, i1); i++) {
    if (type !== null && type !== undefined) m.cells[j * m.w + i] = type;
    if (floor !== undefined) m.floorCells[j * m.w + i] = floor;
  }
}
// 빛 지도: 램프(점광원)의 기여를 칸마다 더한다. URP 점광원 감쇠를 (1-d/range)^2 로 근사
function addLight(m, arr, L, mul = 1) {
  const r = L.r, R = Math.ceil(r / m.res);
  const [ci, cj] = cellOf(m, L.x, L.z);
  const k = L.i * (L.k || 0.36) * mul, cr = L.c[0], cg = L.c[1], cb = L.c[2], ly = L.y ?? 3, sy = L.sy ?? 0.6;
  let rect = [Math.max(0, ci - R), Math.max(0, cj - R), Math.min(m.w - 1, ci + R), Math.min(m.h - 1, cj + R)];
  for (let j = rect[1]; j <= rect[3]; j++) for (let i = rect[0]; i <= rect[2]; i++) {
    const x = m.x0 + (i + 0.5) * m.res, z = m.z1 - (j + 0.5) * m.res, dy = ly - sy;
    const d = Math.sqrt((x - L.x) ** 2 + (z - L.z) ** 2 + dy * dy);
    if (d >= r) continue;
    const q = 1 - (d / r) * (d / r), w = q * q * k, o = (j * m.w + i) * 3;
    arr[o] += w * cr; arr[o + 1] += w * cg; arr[o + 2] += w * cb;
  }
  return rect;
}
function rebuildLight(m) {
  m.base.fill(0);
  for (const L of m.lamps) if (L.on !== false && !L.off) addLight(m, m.base, L, L.dim ?? 1);
  m.light.set(m.base); m.dirty = null; m.needRebuild = false;
}
// 매 프레임: 움직이는 빛(아우라, 플래시, 경광등)
function updateDynLights(m) {
  if (m.needRebuild) rebuildLight(m);
  if (m.dirty) {
    for (const r of m.dirty) for (let j = r[1]; j <= r[3]; j++) { const a = (j * m.w + r[0]) * 3, b = (j * m.w + r[2] + 1) * 3; m.light.set(m.base.subarray(a, b), a); }
  }
  m.dirty = [];
  for (const L of m.dyn) if (L.i > 0.001) m.dirty.push(addLight(m, m.light, L));
}

// ------------------------------------------------------------------ 거리
function buildStreet() {
  const D = window.STREET_MAP;
  const m = newMap({ name: 'street', res: D.res, x0: D.x0, z1: D.z1, w: D.w, h: D.h, outside: 1, maxDist: 55,
    ambient: [0.2, 0.22, 0.3], fog: [9, 10, 16], fogDensity: 0.04, exposure: 1.15 });
  m.types = [
    { h: 0 },
    { h: 9, texs: Tex.facades, su: 4, sv: 12 },          // 1 건물
    { h: 1.0, tex: Tex.lowwall, su: 1, sv: 1, cap: Tex.cap }, // 2 난간/화단/턱
  ];
  const near = new Uint8Array(m.w * m.h);
  for (let j = 0; j < m.h; j++) { const row = D.rows[j]; for (let i = 0; i < m.w; i++) { const ch = row[i]; m.cells[j * m.w + i] = ch === '#' ? 1 : ch === 'o' ? 2 : 0; } }
  // 인도: 건물/난간 2m 이내
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    if (m.cells[j * m.w + i]) continue;
    let s = 0;
    for (let dj = -4; dj <= 4 && !s; dj++) for (let di = -4; di <= 4; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < m.w && b < m.h && m.cells[b * m.w + a] === 1) { s = 1; break; } }
    m.floorCells[j * m.w + i] = s;
  }
  Tex.asphalt.scale = 2.5; Tex.sidewalk.scale = 1;
  m.floorTex = [Tex.asphalt, Tex.sidewalk];
  m.lamps = D.lamps.map(l => ({ x: l.x, z: l.z, y: l.y, r: l.r, i: l.i, c: l.c, k: l.home ? 0.4 : 0.3, home: l.home }));
  const top = packRGB(4, 5, 10), mid = packRGB(14, 15, 24);
  m.skyColor = (e, xf) => { const t = clamp01(e * 2.2); return t > 0.5 ? top : packRGB(lerp(26, 6, t * 2), lerp(24, 7, t * 2), lerp(34, 14, t * 2)); };
  rebuildLight(m);
  return m;
}

// ------------------------------------------------------------------ 지하철 칸 + 승강장 (칸 중심이 원점, 칸 길이 방향 = x, 승강장 = +z)
const Train = { travel: 0, speed: 0, atStation: true, lightsOn: true, tunnelLightGap: 9, doorOpen: 0, stopped: false, lobby: false };
function buildTrain() {
  const m = newMap({ name: 'train', res: 0.25, x0: -32, z1: 18, w: 256, h: 88, outside: 3, maxDist: 40,
    ambient: [0.05, 0.05, 0.06], fog: [8, 8, 10], fogDensity: 0.03, ceil: { h: 2.4, tex: Tex.trainCeil }, ceilLight: 0 });
  m.ceilTex = [Tex.trainCeil, Tex.stationCeil, Tex.stationCeil];
  Tex.trainCeil.scale = 1; Tex.trainFloor.scale = 1; Tex.stationFloor.scale = 1; Tex.tactile.scale = 0.5;
  const tunnelCol = (hx, wy) => {
    // 창밖 터널: 열차가 달리면 조명이 뒤로 흘러간다
    const x = hx + Train.travel; const g = Train.tunnelLightGap; const ph = ((x % g) + g) % g;
    const lamp = Math.exp(-((ph - g / 2) ** 2) * (Train.speed > 1 ? 0.15 : 2.5)) * (wy > 1.3 && wy < 1.9 ? 1 : 0.25);
    const base = 18 + vnoise(x * 0.8, wy * 3) * 12;
    return [base + lamp * 220, base + lamp * 190, base + lamp * 140];
  };
  const winDyn = (outward) => (u, wy, hx, hz) => {
    if (wy < 0.85 || wy > 1.95 || (u > 0.46 && u < 0.54)) { const c = 150 + (wy > 1.95 ? 20 : 0); return [c * 0.92, c * 0.9, c * 0.84]; } // 창틀
    if (outward && Train.atStation && Train.speed < 0.5) { const t = ((hx * 2) % 1 + 1) % 1; const tile = (t < 0.04 || ((wy * 4) % 1) < 0.05) ? 120 : 196; return [tile * 0.9, tile * 0.92, tile * 0.88]; }
    return tunnelCol(hx, wy);
  };
  m.types = [
    { h: 0 },
    { h: 2.4, tex: Tex.trainWall, su: 2, sv: 2.4 },                               // 1 칸 벽
    { h: 2.4, tex: Tex.trainWall, su: 2, sv: 2.4, dyn: winDyn(false), emit: 0.75 },           // 2 터널쪽 창
    { h: 4, tex: Tex.tunnel, su: 3, sv: 4 },                                      // 3 바깥(터널 벽)
    { h: 2.4, tex: Tex.door, su: 1.3, sv: 2.4 },                                  // 4 문
    { h: 2.4, tex: Tex.trainWall, su: 2, sv: 2.4, dyn: winDyn(true), emit: 0.75 },            // 5 승강장쪽 창
    { h: 0.45, tex: Tex.seat, su: 1, sv: 0.45, cap: Tex.seat },                   // 6 좌석
    { h: 2.4, tex: Tex.tile, su: 1, sv: 1 },                                      // 7 역 벽 (타일)
    { h: 2.4, tex: Tex.pillar, su: 0.5, sv: 2.4 },                                // 8 기둥
    { h: 2.4, dyn: (u, wy) => { const t = Tex.watch1 && Train.watchArrived ? Tex.watch2 : Tex.watch1; if (!t || wy < 1.7) { const c = 40; return [c, c, c]; } const o = (((clamp01(1 - (wy - 1.7) / 0.6) * t.h) | 0) * t.w + ((u * t.w) | 0)) * 4; return [t.d[o], t.d[o + 1], t.d[o + 2]]; }, tex: Tex.tile, su: 2, sv: 2.4, emit: 1.2, base: 1.7, see: true }, // 9 역 시계 화면
  ];
  // 승강장 바닥과 벽
  fillRect(m, -32, 32, -18, 18, 3);
  fillRect(m, -30, 30, 1.45, 13, 0, 1);          // 승강장
  fillRect(m, -30, 30, 1.45, 2.2, 0, 2);         // 점자 블록
  fillRect(m, 4, 7.5, 13, 17.5, 0, 1);           // 계단 입구
  for (const px of [-20, -10, 10, 20]) fillRect(m, px - 0.4, px + 0.4, 7, 7.8, 8);
  fillRect(m, -30, 30, 13, 13.25, 7); fillRect(m, 4, 7.5, 13, 13.25, 0);
  fillRect(m, -1.5, 1.5, 12.75, 13, 9);            // 디지털 시계
  fillRect(m, -30, -29.75, 1.45, 13, 7); fillRect(m, 29.75, 30, 1.45, 13, 7);
  // 앞뒤로 이어진 다른 칸들 (승강장에서 보이는 창)
  fillRect(m, -32, -9.25, -1.7, 1.7, 5); fillRect(m, 9.25, 32, -1.7, 1.7, 5);
  // 칸 (x -9..9, z -1.45..1.45)
  fillRect(m, -9.25, 9.25, -1.7, 1.7, 1);
  fillRect(m, -9, 9, -1.45, 1.45, 0, 0);
  fillRect(m, -9, 9, -1.7, -1.45, 2);              // 터널쪽 창
  fillRect(m, -9, 9, 1.45, 1.7, 5);                // 승강장쪽 창
  m.doors = [-6, 0, 6];
  for (const dx of m.doors) fillRect(m, dx - 0.65, dx + 0.65, 1.45, 1.7, 4);
  // 좌석 (문 앞 제외)
  const segs = [[-8.8, -6.8], [-5.2, -0.8], [0.8, 5.2], [6.8, 8.8]];
  for (const [a, b] of segs) { fillRect(m, a, b, -1.45, -0.95, 6); fillRect(m, a, b, 0.95, 1.45, 6); }
  m.floorTex = [Tex.trainFloor, Tex.stationFloor, Tex.tactile];
  m.skyColor = () => 0xff000000;
  m.lamps = [];
  for (let x = -7.5; x <= 7.5; x += 2.5) m.lamps.push({ x, z: 0, y: 2.3, r: 4.5, i: 2.2, c: [1, 0.98, 0.9], k: 0.16, group: 'car' });
  for (let x = -27; x <= 27; x += 6) m.lamps.push({ x, z: 7, y: 3.2, r: 8, i: 2.2, c: [0.95, 0.97, 1], k: 0.22, group: 'station' });
  m.lamps.push({ x: 5.7, z: 15, y: 3, r: 6, i: 2, c: [1, 0.95, 0.85], k: 0.5, group: 'station' });
  rebuildLight(m);
  return m;
}
function setTrainDoors(m, open) {
  // 문이 열리면(슬라이드 0.64m * 2) 지나갈 수 있다
  for (const dx of m.doors) fillRect(m, dx - 0.65, dx + 0.65, 1.45, 1.7, open ? 0 : 4);
  if (open) for (const dx of m.doors) fillRect(m, dx - 0.65, dx + 0.65, 1.45, 1.7, undefined, 0);
}
function setTrainLights(m, on, group) {
  for (const L of m.lamps) if (!group || L.group === group) L.off = !on;
  rebuildLight(m);
}

// ------------------------------------------------------------------ 집 (Home 씬: 방 5m x 6m)
function buildHome() {
  const m = newMap({ name: 'home', res: 0.1, x0: -2.8, z1: 3.3, w: 56, h: 66, outside: 1, maxDist: 12,
    ambient: [0.07, 0.065, 0.07], fog: [4, 4, 6], fogDensity: 0.08, ceil: { h: 2.8, tex: Tex.homeCeil } });
  Tex.wood.scale = 1; Tex.homeCeil.scale = 1;
  m.types = [
    { h: 0 },
    { h: 2.8, tex: Tex.wallpaper, su: 1, sv: 2.8 },                        // 1 벽
    { h: 2.8, tex: Tex.homeDoor, su: 0.95, sv: 2.0, base: 0 },             // 2 문
    { h: 2.8, tex: Tex.curtain, su: 0.6, sv: 2.8 },                        // 3 커튼 친 창
    { h: 0.73, tex: Tex.bed, su: 1.6, sv: 0.73, cap: Tex.bed },            // 4 침대
    { h: 0.6, tex: Tex.wood, su: 0.6, sv: 0.6, cap: Tex.wood },            // 5 협탁
    { h: 1.89, tex: Tex.darkwood, su: 0.6, sv: 1.89, cap: Tex.darkwood },  // 6 옷장
    { h: 0.68, tex: Tex.wood, su: 1, sv: 0.68, cap: Tex.wood },            // 7 TV 장
    { h: 0.8, tex: Tex.darkwood, su: 0.5, sv: 0.8, cap: Tex.darkwood },    // 8 상자
  ];
  fillRect(m, -2.8, 2.8, -3.3, 3.3, 1);
  fillRect(m, -2.5, 2.5, -3, 3, 0, 0);
  fillRect(m, -0.77, 1.13, 3, 3.1, 3);
  fillRect(m, 0.92, 1.87, -3.1, -3, 2);
  fillRect(m, -2.5, -0.94, 1.04, 2.94, 4);
  fillRect(m, -1.01, -0.38, 2.55, 3, 5);
  fillRect(m, 1.88, 2.5, 1.48, 2.79, 6);
  fillRect(m, 1.88, 2.5, -1.3, 1.32, 7);
  fillRect(m, -2.5, -2.13, -2.78, -1.48, 8);
  m.floorTex = [Tex.wood];
  m.skyColor = () => 0xff000000;
  m.lamps = [{ x: 0, z: 0.3, y: 2.6, r: 7, i: 2.4, c: [1, 0.86, 0.66], k: 0.3 }];
  rebuildLight(m);
  return m;
}

// ------------------------------------------------------------------ 길찾기 (NavMesh 대신 격자 A*)
function findPath(m, sx, sz, tx, tz, maxIter = 40000) {
  const w = m.w, h = m.h, cells = m.cells;
  let [si, sj] = cellOf(m, sx, sz), [ti, tj] = cellOf(m, tx, tz);
  const ok = (i, j) => i >= 0 && j >= 0 && i < w && j < h && cells[j * w + i] === 0;
  const snap = (i, j) => { if (ok(i, j)) return [i, j]; for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (ok(i + di, j + dj)) return [i + di, j + dj]; return null; };
  const s = snap(si, sj), t = snap(ti, tj); if (!s || !t) return null;
  [si, sj] = s; [ti, tj] = t;
  const N = w * h, g = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { const l = 2 * i + 1, r = l + 1; let mn = i; if (l < heap.length && heap[l][0] < heap[mn][0]) mn = l; if (r < heap.length && heap[r][0] < heap[mn][0]) mn = r; if (mn === i) break;[heap[mn], heap[i]] = [heap[i], heap[mn]]; i = mn; } } return top; };
  const hfn = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); };
  const sk = sj * w + si, tk = tj * w + ti; g[sk] = 0; push(hfn(si, sj), sk);
  let it = 0;
  while (heap.length && it++ < maxIter) {
    const [, k] = pop(); if (closed[k]) continue; closed[k] = 1;
    if (k === tk) break;
    const i = k % w, j = (k / w) | 0;
    for (let d = 0; d < 8; d++) {
      const di = [1, -1, 0, 0, 1, 1, -1, -1][d], dj = [0, 0, 1, -1, 1, -1, 1, -1][d];
      const ni = i + di, nj = j + dj; if (!ok(ni, nj)) continue;
      if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue;
      const nk = nj * w + ni, ng = g[k] + (di && dj ? 1.414 : 1);
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + hfn(ni, nj), nk); }
    }
  }
  if (from[tk] < 0 && tk !== sk) return null;
  const pts = []; let k = tk;
  while (k !== -1 && k !== sk) { pts.push(k); k = from[k]; }
  pts.reverse();
  // 경로 단순화 (직선 가시성)
  const P = pts.map(k => [m.x0 + ((k % w) + 0.5) * m.res, m.z1 - (((k / w) | 0) + 0.5) * m.res]);
  const out = []; let a = [sx, sz];
  for (let i = 0; i < P.length; i++) {
    if (i === P.length - 1 || !lineClear(m, a[0], a[1], P[i + 1][0], P[i + 1][1], 0.2)) { out.push(P[i]); a = P[i]; }
  }
  return out;
}
function lineClear(m, ax, az, bx, bz, pad = 0) {
  const d = dist2(ax, az, bx, bz), n = Math.ceil(d / (m.res * 0.5)) + 1;
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = lerp(ax, bx, t), z = lerp(az, bz, t);
    if (cellType(m, x, z)) return false;
    if (pad && (cellType(m, x + pad, z) || cellType(m, x - pad, z) || cellType(m, x, z + pad) || cellType(m, x, z - pad))) return false;
  }
  return true;
}
// 시야 확인: 높은 벽만 가린다 (낮은 난간은 넘어 보임)
function sightClear(m, ax, az, bx, bz) {
  const d = dist2(ax, az, bx, bz), n = Math.ceil(d / (m.res * 0.5)) + 1;
  for (let k = 1; k < n; k++) {
    const t = k / n, ty = cellType(m, lerp(ax, bx, t), lerp(az, bz, t));
    if (ty && m.types[ty].h >= 1.7) return false;
  }
  return true;
}
function randomWalkable(m) {
  for (let k = 0; k < 200; k++) { const i = randInt(0, m.w), j = randInt(0, m.h); if (m.cells[j * m.w + i] === 0) return [m.x0 + (i + 0.5) * m.res, m.z1 - (j + 0.5) * m.res]; }
  return null;
}
function nearestWalkable(m, x, z) {
  if (!cellType(m, x, z)) return [x, z];
  for (let r = 1; r < 12; r++) for (let a = 0; a < 16; a++) { const nx = x + Math.cos(a / 16 * Math.PI * 2) * r * m.res, nz = z + Math.sin(a / 16 * Math.PI * 2) * r * m.res; if (!cellType(m, nx, nz)) return [nx, nz]; }
  return [x, z];
}
