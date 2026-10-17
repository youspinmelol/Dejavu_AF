// 텍스처/스프라이트: 원본의 3D 모델과 머티리얼 대신 코드로 그린 그림 (레이캐스터용 RGBA 배열)
'use strict';

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: d.data, canvas: c }; }
function paint(w, h, fn) { const c = makeCanvas(w, h); fn(c.getContext('2d'), w, h); return toTex(c); }
function noiseFill(g, w, h, base, amt, seed = 1) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, n = (hash2(x + seed * 131, y * 7 + seed) - 0.5) * amt + (vnoise(x / 6 + seed, y / 6) - 0.5) * amt;
    d[i] = clamp(base[0] + n, 0, 255); d[i + 1] = clamp(base[1] + n, 0, 255); d[i + 2] = clamp(base[2] + n, 0, 255); d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

const Tex = {};
const Spr = {};
const Img = {};

function buildTextures() {
  // ---- 거리
  Tex.asphalt = paint(64, 64, (g, w, h) => {
    noiseFill(g, w, h, [66, 67, 70], 26, 3);
    g.strokeStyle = 'rgba(15,15,15,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(5, 40); g.lineTo(20, 36); g.lineTo(28, 44); g.lineTo(45, 41); g.stroke();
  });
  Tex.sidewalk = paint(64, 64, (g, w, h) => {
    noiseFill(g, w, h, [78, 76, 72], 20, 5);
    g.strokeStyle = 'rgba(30,30,30,0.7)'; g.lineWidth = 2;
    for (let i = 0; i <= 64; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  });
  Tex.facades = [0, 1, 2, 3].map(k => paint(128, 384, (g, w, h) => {
    const bases = [[58, 52, 48], [44, 47, 52], [64, 58, 50], [38, 38, 40]];
    noiseFill(g, w, h, bases[k], 18, 10 + k);
    // 층 구분선
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let f = 1; f < 4; f++) g.fillRect(0, h - f * 96 - 3, w, 4);
    // 1층: 셔터 또는 가게 유리
    if (k % 2 === 0) {
      g.fillStyle = '#3a3c40'; g.fillRect(8, h - 86, w - 16, 80);
      g.fillStyle = 'rgba(0,0,0,0.4)'; for (let y = h - 86; y < h - 6; y += 5) g.fillRect(8, y, w - 16, 1);
    } else {
      g.fillStyle = '#121418'; g.fillRect(10, h - 80, w - 20, 66);
      g.strokeStyle = '#555'; g.lineWidth = 3; g.strokeRect(10, h - 80, w - 20, 66);
    }
    // 위층 창문
    for (let f = 1; f < 4; f++) for (let wx = 0; wx < 2; wx++) {
      const x = 14 + wx * 60, y = h - f * 96 - 70;
      const lit = hash2(k * 17 + wx, f * 3) < 0.3;
      g.fillStyle = lit ? '#e8b060' : '#0d0f14'; g.fillRect(x, y, 40, 46);
      if (lit) { g.fillStyle = 'rgba(80,40,10,0.5)'; g.fillRect(x, y + 30, 40, 16); }
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.strokeRect(x, y, 40, 46);
    }
  }));
  Tex.lowwall = paint(32, 32, (g, w, h) => { noiseFill(g, w, h, [70, 70, 68], 22, 7); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 3); });
  Tex.cap = paint(16, 16, (g, w, h) => noiseFill(g, w, h, [88, 88, 86], 16, 9));
  // ---- 지하철/역
  Tex.trainWall = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [176, 172, 160], 10, 21); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 44, w, 2); g.fillStyle = '#8a8478'; g.fillRect(0, 46, w, 18); });
  Tex.trainFloor = paint(64, 64, (g, w, h) => noiseFill(g, w, h, [70, 72, 74], 22, 22));
  Tex.trainCeil = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [176, 176, 170], 8, 23); g.fillStyle = '#fffbe8'; g.fillRect(26, 0, 12, 64); });
  Tex.stationCeil = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [96, 98, 100], 10, 37); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 31, w, 2); g.fillStyle = '#f4f2e8'; g.fillRect(28, 6, 8, 52); });
  Tex.seat = paint(32, 32, (g, w, h) => { noiseFill(g, w, h, [60, 80, 120], 18, 24); g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 0; x < 32; x += 8) g.fillRect(x, 0, 1, 32); });
  Tex.door = paint(64, 128, (g, w, h) => {
    noiseFill(g, w, h, [150, 152, 150], 10, 25); g.fillStyle = '#222'; g.fillRect(31, 0, 2, h);
    g.fillStyle = '#101418'; g.fillRect(8, 22, 18, 44); g.fillRect(38, 22, 18, 44);
  });
  Tex.tile = paint(64, 64, (g, w, h) => {
    noiseFill(g, w, h, [190, 192, 188], 10, 26); g.fillStyle = 'rgba(60,60,60,0.5)';
    for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
  });
  Tex.stationFloor = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [120, 118, 112], 16, 27); g.fillStyle = 'rgba(40,40,40,0.4)'; for (let i = 0; i < 64; i += 32) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); } });
  Tex.tactile = paint(32, 32, (g, w, h) => { g.fillStyle = '#d8b020'; g.fillRect(0, 0, w, h); g.fillStyle = '#b08c10'; for (let y = 3; y < 32; y += 8) for (let x = 3; x < 32; x += 8) { g.beginPath(); g.arc(x + 1, y + 1, 2, 0, 7); g.fill(); } });
  Tex.pillar = paint(32, 64, (g, w, h) => { noiseFill(g, w, h, [70, 110, 96], 12, 28); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(4, 0, 3, h); });
  Tex.tunnel = paint(64, 64, (g, w, h) => noiseFill(g, w, h, [36, 34, 32], 26, 29));
  // ---- 집
  Tex.wallpaper = paint(64, 128, (g, w, h) => {
    noiseFill(g, w, h, [150, 138, 112], 12, 30); g.fillStyle = 'rgba(90,70,50,0.18)';
    for (let x = 0; x < 64; x += 16) for (let y = 0; y < 128; y += 20) { g.beginPath(); g.arc(x + 8 + (y / 20 % 2) * 8, y + 10, 3, 0, 7); g.fill(); }
    g.fillStyle = '#5a4430'; g.fillRect(0, h - 10, w, 10);
  });
  Tex.wood = paint(64, 64, (g, w, h) => {
    noiseFill(g, w, h, [104, 72, 46], 14, 31); g.fillStyle = 'rgba(40,20,10,0.35)';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1, 64);
  });
  Tex.homeCeil = paint(32, 32, (g, w, h) => noiseFill(g, w, h, [170, 168, 160], 8, 32));
  Tex.bed = paint(64, 32, (g, w, h) => { noiseFill(g, w, h, [196, 194, 188], 12, 33); g.fillStyle = 'rgba(120,120,140,0.35)'; g.fillRect(0, 0, w, 6); });
  Tex.darkwood = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [72, 48, 30], 14, 34); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(31, 0, 2, h); g.fillRect(0, 20, w, 2); });
  Tex.homeDoor = paint(64, 128, (g, w, h) => { noiseFill(g, w, h, [96, 66, 42], 10, 35); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3; g.strokeRect(10, 10, 44, 46); g.strokeRect(10, 70, 44, 50); g.fillStyle = '#c8b070'; g.fillRect(50, 64, 6, 6); });
  Tex.window = paint(64, 64, (g, w, h) => { g.fillStyle = '#0a0e18'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(150,170,220,0.15)'; g.fillRect(4, 4, 26, 56); g.fillRect(34, 4, 26, 56); g.fillStyle = '#ddd'; g.fillRect(0, 0, w, 3); g.fillRect(0, 61, w, 3); g.fillRect(30, 0, 4, h); });
  Tex.curtain = paint(64, 64, (g, w, h) => { noiseFill(g, w, h, [120, 40, 40], 10, 36); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 3, h); });
}

// ---------------------------------------------------------------- 인물 스프라이트
function drawGirl(g, w, h, opt = {}) {
  // 키 약 1.25m. 창백한 원피스, 얼굴을 덮은 검은 머리, 토끼 인형
  const cx = w / 2;
  g.fillStyle = '#1a1a1a'; g.fillRect(cx - 14, h * 0.82, 10, h * 0.18); g.fillRect(cx + 4, h * 0.82, 10, h * 0.18); // 다리
  g.fillStyle = '#d8d6cc'; g.fillRect(cx - 14, h * 0.82, 10, h * 0.08); g.fillRect(cx + 4, h * 0.82, 10, h * 0.08);
  const dress = g.createLinearGradient(0, h * 0.3, 0, h * 0.85); dress.addColorStop(0, '#cfc8bc'); dress.addColorStop(1, '#8e867a');
  g.fillStyle = dress; g.beginPath(); g.moveTo(cx - 16, h * 0.32); g.lineTo(cx + 16, h * 0.32); g.lineTo(cx + 28, h * 0.84); g.lineTo(cx - 28, h * 0.84); g.closePath(); g.fill();
  g.fillStyle = 'rgba(90,20,20,0.5)'; g.beginPath(); g.ellipse(cx + 6, h * 0.55, 7, 12, 0.3, 0, 7); g.fill(); // 얼룩
  g.fillStyle = '#e6e0d6'; g.fillRect(cx - 24, h * 0.34, 7, h * 0.26); g.fillRect(cx + 17, h * 0.34, 7, h * 0.26); // 팔
  // 머리
  g.fillStyle = '#e8e2d8'; g.beginPath(); g.ellipse(cx, h * 0.2, 15, 18, 0, 0, 7); g.fill();
  g.fillStyle = '#060606'; g.beginPath(); g.moveTo(cx - 19, h * 0.42); g.quadraticCurveTo(cx - 22, h * 0.05, cx, h * 0.07); g.quadraticCurveTo(cx + 22, h * 0.05, cx + 19, h * 0.42);
  g.lineTo(cx + 9, h * 0.3); g.lineTo(cx + 4, h * 0.34); g.lineTo(cx - 3, h * 0.28); g.lineTo(cx - 10, h * 0.35); g.closePath(); g.fill();
  if (opt.buttons) { g.fillStyle = '#c01818'; g.beginPath(); g.arc(cx - 6, h * 0.2, 3, 0, 7); g.fill(); g.fillStyle = '#1838c0'; g.beginPath(); g.arc(cx + 6, h * 0.2, 3, 0, 7); g.fill(); }
  else { g.fillStyle = '#000'; g.fillRect(cx - 9, h * 0.19, 5, 3); g.fillRect(cx + 4, h * 0.19, 5, 3); }
  if (opt.doll !== false) { // 토끼 인형
    g.fillStyle = '#b8aea0'; g.beginPath(); g.ellipse(cx + 18, h * 0.52, 9, 12, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(cx + 18, h * 0.42, 7, 7, 0, 0, 7); g.fill();
    g.fillRect(cx + 13, h * 0.3, 3, 10); g.fillRect(cx + 20, h * 0.3, 3, 10);
    g.fillStyle = '#300'; g.fillRect(cx + 15, h * 0.41, 2, 2); g.fillRect(cx + 20, h * 0.41, 2, 2);
  }
}
function drawFather(g, w, h, opt = {}) {
  const cx = w / 2;
  g.fillStyle = '#16161a'; g.fillRect(cx - 18, h * 0.55, 14, h * 0.45); g.fillRect(cx + 4, h * 0.55, 14, h * 0.45);
  const coat = g.createLinearGradient(0, h * 0.15, 0, h * 0.6); coat.addColorStop(0, '#3a3530'); coat.addColorStop(1, '#25221f');
  g.fillStyle = coat; g.beginPath(); g.moveTo(cx - 26, h * 0.17); g.lineTo(cx + 26, h * 0.17); g.lineTo(cx + 22, h * 0.6); g.lineTo(cx - 22, h * 0.6); g.closePath(); g.fill();
  g.fillRect(cx - 34, h * 0.18, 9, h * 0.36); g.fillRect(cx + 25, h * 0.18, 9, h * 0.36);
  g.fillStyle = '#d6cfc4'; g.fillRect(cx - 33, h * 0.53, 8, 10); g.fillRect(cx + 25, h * 0.53, 8, 10);
  g.fillStyle = '#e6e2dc'; g.fillRect(cx - 4, h * 0.17, 8, h * 0.15); // 셔츠
  g.fillStyle = '#d4ccc0'; g.beginPath(); g.ellipse(cx, h * 0.085, 12, 15, 0, 0, 7); g.fill();
  g.fillStyle = '#1a1612'; g.beginPath(); g.ellipse(cx, h * 0.04, 13, 7, 0, 0, 7); g.fill();
  g.fillStyle = '#050505'; g.fillRect(cx - 7, h * 0.08, 5, 4); g.fillRect(cx + 2, h * 0.08, 5, 4); g.fillRect(cx - 4, h * 0.125, 8, 2);
  g.fillStyle = 'rgba(110,10,10,0.75)'; g.fillRect(cx - 13, h * 0.1, 26, 3); // 목/머리 상처
  g.fillRect(cx - 2, h * 0.14, 4, h * 0.2);
}
function drawMother(g, w, h, opt = {}) {
  const cx = w / 2;
  const dress = g.createLinearGradient(0, h * 0.15, 0, h); dress.addColorStop(0, '#eceae4'); dress.addColorStop(1, '#a8a6a0');
  g.fillStyle = dress; g.beginPath(); g.moveTo(cx - 18, h * 0.18); g.lineTo(cx + 18, h * 0.18); g.lineTo(cx + 34, h); g.lineTo(cx - 34, h); g.closePath(); g.fill();
  g.fillStyle = '#e8e6e0'; g.fillRect(cx - 27, h * 0.19, 8, h * 0.38); g.fillRect(cx + 19, h * 0.19, 8, h * 0.38);
  g.fillStyle = '#f2f0ea'; g.beginPath(); g.ellipse(cx, h * 0.09, 12, 15, 0, 0, 7); g.fill();
  g.fillStyle = '#0a0a0a'; g.beginPath(); g.moveTo(cx - 16, h * 0.42); g.quadraticCurveTo(cx - 20, h * 0.0, cx, h * 0.02); g.quadraticCurveTo(cx + 20, h * 0.0, cx + 16, h * 0.42);
  g.lineTo(cx + 8, h * 0.16); g.lineTo(cx - 8, h * 0.16); g.closePath(); g.fill();
  g.fillStyle = '#000'; g.beginPath(); g.ellipse(cx - 5, h * 0.09, 3.5, 4.5, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(cx + 5, h * 0.09, 3.5, 4.5, 0, 0, 7); g.fill();
  g.fillStyle = '#300'; g.beginPath(); g.ellipse(cx, h * 0.14, 4, 3, 0, 0, 7); g.fill();
}
function drawPolice(g, w, h, aim) {
  const cx = w / 2;
  g.fillStyle = '#15192a'; g.fillRect(cx - 16, h * 0.55, 13, h * 0.45); g.fillRect(cx + 3, h * 0.55, 13, h * 0.45);
  g.fillStyle = '#20284a'; g.fillRect(cx - 24, h * 0.17, 48, h * 0.4);
  g.fillStyle = '#c8d020'; g.fillRect(cx - 24, h * 0.32, 48, 5);
  g.fillStyle = '#20284a';
  if (aim) { g.fillRect(cx - 10, h * 0.25, 20, 12); g.fillStyle = '#111'; g.fillRect(cx - 4, h * 0.25, 8, 7); }
  else { g.fillRect(cx - 32, h * 0.18, 9, h * 0.32); g.fillRect(cx + 23, h * 0.18, 9, h * 0.32); }
  g.fillStyle = '#c8b8a4'; g.beginPath(); g.ellipse(cx, h * 0.09, 11, 13, 0, 0, 7); g.fill();
  g.fillStyle = '#10142a'; g.fillRect(cx - 13, h * 0.01, 26, h * 0.05); g.fillRect(cx - 16, h * 0.055, 32, 3);
}
function buildSprites() {
  const S = (w, h, fn, opt) => paint(w, h, (g, W, H) => fn(g, W, H, opt));
  Spr.girl = S(96, 192, drawGirl, {});
  Spr.girlNoDoll = S(96, 192, drawGirl, { doll: false });
  Spr.girlButtons = S(96, 192, drawGirl, { doll: false, buttons: true });
  Spr.father = S(96, 288, drawFather);
  Spr.mother = S(96, 272, drawMother);
  Spr.police = S(80, 240, (g, w, h) => drawPolice(g, w, h, false));
  Spr.policeAim = S(80, 240, (g, w, h) => drawPolice(g, w, h, true));
  Spr.silhouette = paint(96, 288, (g, w, h) => { drawFather(g, w, h); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgb(15,15,18)'; g.fillRect(0, 0, w, h); });
  Spr.policeCar = paint(256, 96, (g, w, h) => {
    g.fillStyle = '#e8e8ec'; g.fillRect(10, 40, 236, 40); g.fillStyle = '#16182a'; g.fillRect(10, 58, 236, 10);
    g.fillStyle = '#d8d8dc'; g.beginPath(); g.moveTo(60, 40); g.lineTo(80, 14); g.lineTo(176, 14); g.lineTo(200, 40); g.fill();
    g.fillStyle = '#0c1018'; g.fillRect(86, 18, 40, 20); g.fillRect(132, 18, 40, 20);
    g.fillStyle = '#111'; g.beginPath(); g.arc(60, 82, 13, 0, 7); g.arc(196, 82, 13, 0, 7); g.fill();
    g.fillStyle = '#c00'; g.fillRect(104, 6, 22, 8); g.fillStyle = '#03c'; g.fillRect(130, 6, 22, 8);
  });
  Spr.lampPost = paint(24, 256, (g, w, h) => {
    g.fillStyle = '#2a2c30'; g.fillRect(10, 20, 4, h - 20); g.fillRect(4, h - 8, 16, 8);
    g.fillStyle = '#3a3c40'; g.fillRect(2, 8, 20, 12);
  });
  Spr.lampHead = paint(32, 16, (g, w, h) => { const r = g.createRadialGradient(16, 8, 1, 16, 8, 15); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  Spr.cabinet = paint(64, 128, (g, w, h) => {
    noiseFill(g, w, h, [96, 102, 108], 12, 40); g.strokeStyle = '#3a3e44'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#222';
    for (let y = 14; y < 40; y += 5) g.fillRect(12, y, 40, 2); // 루버(틈새)
    g.fillRect(w - 12, 60, 4, 14);
  });
  Spr.dumpster = paint(128, 96, (g, w, h) => {
    noiseFill(g, w, h, [40, 76, 52], 16, 41); g.fillStyle = '#1e3a28'; g.fillRect(0, 0, w, 14); g.fillStyle = '#111'; g.fillRect(4, 14, w - 8, 3);
    g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(16, 92, 5, 0, 7); g.arc(112, 92, 5, 0, 7); g.fill();
  });
  Spr.paper = paint(32, 16, (g, w, h) => { g.fillStyle = '#d8d2c0'; g.beginPath(); g.moveTo(2, 14); g.lineTo(12, 3); g.lineTo(30, 6); g.lineTo(24, 15); g.fill(); g.fillStyle = 'rgba(80,60,40,0.5)'; g.fillRect(12, 8, 10, 1); });
  Spr.camera = paint(32, 24, (g, w, h) => { g.fillStyle = '#151515'; g.fillRect(2, 6, 28, 16); g.fillRect(6, 2, 10, 5); g.fillStyle = '#444'; g.beginPath(); g.arc(17, 14, 6, 0, 7); g.fill(); g.fillStyle = '#89a'; g.beginPath(); g.arc(17, 14, 3, 0, 7); g.fill(); });
  Spr.sparkle = paint(16, 16, (g, w, h) => { const r = g.createRadialGradient(8, 8, 0, 8, 8, 8); r.addColorStop(0, 'rgba(255,250,235,1)'); r.addColorStop(0.3, 'rgba(255,240,210,0.8)'); r.addColorStop(1, 'rgba(255,230,200,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  Spr.glow = paint(32, 32, (g, w, h) => { const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  Spr.meds = paint(32, 8, (g, w, h) => { g.fillStyle = '#e8e4f0'; g.fillRect(0, 2, w, 6); g.fillStyle = '#c04040'; g.fillRect(4, 3, 6, 4); });
  Spr.frame = paint(32, 26, (g, w, h) => { g.fillStyle = '#5a3a20'; g.fillRect(0, 0, w, h); g.fillStyle = '#eee8da'; g.fillRect(4, 4, w - 8, h - 8); g.fillStyle = '#c33'; g.fillRect(8, 10, 4, 8); g.fillStyle = '#36c'; g.fillRect(14, 9, 4, 9); g.fillStyle = '#c9a'; g.fillRect(20, 12, 3, 6); });
  Spr.tv = paint(64, 48, (g, w, h) => { g.fillStyle = '#111'; g.fillRect(0, 0, w, h - 6); g.fillStyle = '#0a0c10'; g.fillRect(4, 4, w - 8, h - 14); g.fillStyle = '#222'; g.fillRect(24, h - 6, 16, 6); });
  // 점프스케어 얼굴 (화면 전체에 그림)
  Spr.scareFace = makeCanvas(512, 512); (function (g) {
    const r = g.createRadialGradient(256, 260, 40, 256, 260, 250); r.addColorStop(0, '#efe9dd'); r.addColorStop(0.7, '#b8b0a2'); r.addColorStop(1, 'rgba(20,20,20,0)');
    g.fillStyle = r; g.beginPath(); g.ellipse(256, 270, 200, 245, 0, 0, 7); g.fill();
    g.fillStyle = '#050505'; g.beginPath(); g.moveTo(40, 512); g.quadraticCurveTo(10, 0, 256, 20); g.quadraticCurveTo(502, 0, 472, 512); g.lineTo(410, 512); g.quadraticCurveTo(430, 120, 300, 90); g.lineTo(256, 160); g.lineTo(210, 90); g.quadraticCurveTo(80, 120, 102, 512); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(185, 255, 38, 46, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(327, 255, 38, 46, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(120,0,0,0.8)'; g.fillRect(170, 298, 10, 80); g.fillRect(335, 298, 8, 60);
    g.fillStyle = '#100'; g.beginPath(); g.ellipse(256, 400, 46, 58, 0, 0, 7); g.fill();
  })(Spr.scareFace.getContext('2d'));
}

// 원본에서 추출한 이미지 (단서 사진, 로고, 수배 전단, 역 시계)
const IMG_NAMES = ['logo.png', 'Enter_0.png', 'bounty_paper.png', 'Digital_Watch_1.jpg', 'Digital_Watch_2.jpg',
  'HideandSeekart.webp', 'Quiz_book.webp', 'Strawberry_hairpin.webp', 'doll_button.webp', 'flim_tape.webp', 'memo_paper.webp', 'news_paper.webp', 'parent_frame.webp', 'receipt.webp'];
function loadImages() {
  return Promise.all(IMG_NAMES.map(n => new Promise(res => {
    const im = new Image(); im.onload = () => { Img[n.replace(/\.\w+$/, '')] = im; res(); }; im.onerror = () => res(); im.src = 'assets/img/' + n;
  }))).then(() => {
    // 이미지 → 텍스처(픽셀 읽기는 http 에서만 가능. file:// 이면 대체 그림 사용)
    const imgTex = (im, w, h) => { try { const c = makeCanvas(w, h); c.getContext('2d').drawImage(im, 0, 0, w, h); return toTex(c); } catch (e) { return null; } };
    if (Img.bounty_paper) Spr.poster = imgTex(Img.bounty_paper, 64, 128);
    if (!Spr.poster || !Spr.poster.d) Spr.poster = paint(64, 128, (g, w, h) => { g.fillStyle = '#c8b898'; g.fillRect(4, 2, w - 8, h - 4); g.fillStyle = '#6a1010'; g.fillRect(8, 8, w - 16, 16); g.fillStyle = '#222'; g.fillRect(14, 34, w - 28, 50); });
    if (Img.Digital_Watch_1) { Tex.watch1 = imgTex(Img.Digital_Watch_1, 128, 32); Tex.watch2 = imgTex(Img.Digital_Watch_2, 128, 32); }
  });
}
