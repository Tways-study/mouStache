// Generates the mouStache logo as PNGs (16/32/48/128 + 256 for docs) and public/logo.svg. No deps.
// Logo: blue→indigo squircle, two layered bars behind a white card carrying a handlebar moustache.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { HALF, mustachePath } from '../lib/brand/moustache.mjs'; // single source of the moustache shape

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Anti-aliased coverage of a rounded rect whose origin is (0,0); x,y relative to it.
function rrectCov(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return clamp01(0.5 - (Math.hypot(x - cx, y - cy) - r));
}
// Coverage of a round-capped stroke along segment a→b with half-width hw.
function segCov(px, py, ax, ay, bx, by, hw) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return clamp01(0.5 - (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - hw));
}

const INK = [52, 88, 240]; // moustache colour (a deeper blue than the background gradient)

// Distance-based coverage of the variable-width stroke through HALF (mirrored). grow widens it at tiny sizes.
function mustacheCov(nx, ny, N, grow) {
  const x = 0.5 + Math.abs(nx - 0.5);
  let best = Infinity;
  for (let i = 0; i < HALF.length - 1; i++) {
    const [ax, ay, ar] = HALF[i], [bx, by, br] = HALF[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp01(((x - ax) * dx + (ny - ay) * dy) / (dx * dx + dy * dy || 1));
    const d = Math.hypot(x - (ax + t * dx), ny - (ay + t * dy)) - (ar + (br - ar) * t) - grow;
    if (d < best) best = d;
  }
  return clamp01(0.5 - best * N);
}
function render(size) {
  const S = 4; // supersample
  const N = size * S;
  const small = size <= 16;
  const mid = size <= 32;
  const grow = small ? 0.02 : mid ? 0.011 : 0; // bolder moustache at toolbar sizes
  const bars = [
    { x: 0.26, y: 0.17, w: 0.48, h: 0.08, a: 0.45 },
    { x: 0.20, y: 0.26, w: 0.60, h: 0.08, a: 0.72 },
  ];
  const card = { x: 0.14, y: 0.35, w: 0.72, h: 0.47, r: 0.09 };
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = px * S + sx + 0.5, y = py * S + sy + 0.5;
        const cov = rrectCov(x, y, N, N, N * 0.225);
        if (cov <= 0) continue;
        const t = (x + y) / (2 * N);
        let cr = 10 + (94 - 10) * t, cg = 132 + (92 - 132) * t, cb = 255 + (230 - 255) * t; // blue → indigo
        const gloss = 0.14 * (1 - y / N) ** 2; // soft top highlight
        cr += (255 - cr) * gloss; cg += (255 - cg) * gloss; cb += (255 - cb) * gloss;
        for (const l of bars) {
          const lc = rrectCov(x - l.x * N, y - l.y * N, l.w * N, l.h * N, l.h * N * 0.5);
          cr += (255 - cr) * lc * l.a; cg += (255 - cg) * lc * l.a; cb += (255 - cb) * lc * l.a;
        }
        if (!small) { // soft drop shadow under the card for depth
          const sc = rrectCov(x - card.x * N, y - (card.y + 0.03) * N, card.w * N, card.h * N, card.r * N);
          cr *= 1 - 0.2 * sc; cg *= 1 - 0.2 * sc; cb *= 1 - 0.2 * sc;
        }
        const cc = rrectCov(x - card.x * N, y - card.y * N, card.w * N, card.h * N, card.r * N);
        cr += (255 - cr) * cc; cg += (255 - cg) * cc; cb += (255 - cb) * cc;
        const ink = mustacheCov(x / N, y / N, N, grow) * cc;
        cr += (INK[0] - cr) * ink; cg += (INK[1] - cg) * ink; cb += (INK[2] - cb) * ink;
        r += cr * cov; g += cg * cov; b += cb * cov; a += cov;
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a > 0) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <title>mouStache</title>
  <defs>
    <linearGradient id="moustache-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset="1" stop-color="#5E5CE6"/></linearGradient>
  </defs>
  <rect width="128" height="128" rx="29" fill="url(#moustache-g)"/>
  <rect x="33.3" y="21.8" width="61.4" height="10.2" rx="5.1" fill="#fff" fill-opacity=".45"/>
  <rect x="25.6" y="33.3" width="76.8" height="10.2" rx="5.1" fill="#fff" fill-opacity=".72"/>
  <rect x="17.9" y="44.8" width="92.2" height="60.2" rx="11.5" fill="#fff"/>
  <path d="${mustachePath()}" fill="#3458F0"/>
</svg>
`;

mkdirSync('public/icon', { recursive: true });
mkdirSync('docs', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icon/${s}.png`, render(s));
writeFileSync('docs/logo-256.png', render(256));
writeFileSync('public/logo.svg', SVG);
console.log('logo written');

// ───────── desktop tray glyphs (desktop/resources/tray) ─────────
// Monochrome moustache from the same shared shape. States: idle, curl (just captured), paused (dimmed + slash),
// attention (dot). macOS: black "Template" images the menu bar tints itself. Windows: dark glyph for a light
// taskbar (onlight-*) and white for a dark one (ondark-*). Each at 16px and @2x (32px).
const TRAY_K = 0.5 / 0.92; // logo units per canvas unit: the moustache spans ~92% of the icon width
const rot = (pts, deg) => {
  const a = (deg * Math.PI) / 180, cx = 0.5, cy = 0.6;
  return pts.map(([x, y, r]) => {
    if (x <= 0.5) return [x, y, r];
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a), r];
  });
};
const TRAY_SHAPES = { idle: HALF, curl: rot(HALF, -13), paused: HALF, attention: HALF };

function glyphCov(nx, ny, size, pts) {
  const lx = 0.5 + Math.abs(nx - 0.5) * TRAY_K, ly = 0.565 + (ny - 0.5) * TRAY_K;
  const x = lx;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, ar] = pts[i], [bx, by, br] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp01(((x - ax) * dx + (ly - ay) * dy) / (dx * dx + dy * dy || 1));
    const d = Math.hypot(x - (ax + t * dx), ly - (ay + t * dy)) - (ar + (br - ar) * t) - 0.012; // a touch bolder for tiny sizes
    if (d < best) best = d;
  }
  return clamp01(0.5 - (best / TRAY_K) * size);
}

function renderTray(size, state, ink, dot) {
  const S = 4, N = size * S;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const pts = TRAY_SHAPES[state];
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let a = 0, dr = 0, dg = 0, db = 0, da = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = (px * S + sx + 0.5) / N, y = (py * S + sy + 0.5) / N;
        let c = glyphCov(x, y, N / S, pts) * (state === 'paused' ? 0.45 : 1);
        if (state === 'paused') c = Math.max(c, segCov(x * N, y * N, 0.14 * N, 0.88 * N, 0.86 * N, 0.12 * N, 0.045 * N));
        a += c;
        if (state === 'attention') {
          const dc = clamp01(0.5 - (Math.hypot(x - 0.8, y - 0.24) - 0.17) * N);
          da += dc; dr += dc * dot[0]; dg += dc * dot[1]; db += dc * dot[2];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const ia = a / (S * S), dca = da / (S * S);
      const total = Math.min(1, ia + dca);
      if (total > 0) {
        // blend ink and dot by coverage
        const wi = ia / (ia + dca || 1), wd = 1 - wi;
        raw[o] = ink[0] * wi + (dr / (da || 1)) * wd;
        raw[o + 1] = ink[1] * wi + (dg / (da || 1)) * wd;
        raw[o + 2] = ink[2] * wi + (db / (da || 1)) * wd;
      }
      raw[o + 3] = Math.round(total * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('desktop/resources/tray', { recursive: true });
const ORANGE = [255, 159, 10];
for (const state of Object.keys(TRAY_SHAPES)) {
  const file = state === 'curl' ? 'curl' : state;
  for (const [suffix, size] of [['', 16], ['@2x', 32]]) {
    writeFileSync(`desktop/resources/tray/mac-${file}Template${suffix}.png`, renderTray(size, state, [0, 0, 0], [0, 0, 0]));
    writeFileSync(`desktop/resources/tray/onlight-${file}${suffix}.png`, renderTray(size, state, [28, 28, 30], ORANGE));
    writeFileSync(`desktop/resources/tray/ondark-${file}${suffix}.png`, renderTray(size, state, [255, 255, 255], ORANGE));
  }
}
console.log('tray glyphs written');

// ───────── packaging icons (desktop/build): icon.ico (Windows), icon.icns (macOS), icon.png (512) ─────────
// Pure Node, no tools. Both containers embed PNG images, which every supported Windows and macOS version reads.
const png = Object.fromEntries([16, 32, 48, 64, 128, 256, 512].map((s) => [s, render(s)]));

// ICO: ICONDIR + one ICONDIRENTRY per image, then the PNG payloads (size byte 0 means 256).
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoHead = Buffer.alloc(6);
icoHead.writeUInt16LE(1, 2); // type = icon
icoHead.writeUInt16LE(icoSizes.length, 4);
let icoOffset = 6 + 16 * icoSizes.length;
const icoDir = icoSizes.map((s) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); // planes, bpp
  e.writeUInt32LE(png[s].length, 8); e.writeUInt32LE(icoOffset, 12);
  icoOffset += png[s].length;
  return e;
});

// ICNS: 'icns' + total length, then [type, length, PNG] elements. 16/32/128/256/512 plus retina duplicates.
const icnsTypes = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic09', 512]];
const icnsBody = Buffer.concat(icnsTypes.map(([t, s]) => {
  const h = Buffer.alloc(8);
  h.write(t, 0, 'ascii'); h.writeUInt32BE(8 + png[s].length, 4);
  return Buffer.concat([h, png[s]]);
}));
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii'); icnsHead.writeUInt32BE(8 + icnsBody.length, 4);

mkdirSync('desktop/build', { recursive: true });
writeFileSync('desktop/build/icon.ico', Buffer.concat([icoHead, ...icoDir, ...icoSizes.map((s) => png[s])]));
writeFileSync('desktop/build/icon.icns', Buffer.concat([icnsHead, icnsBody]));
writeFileSync('desktop/build/icon.png', png[512]);
console.log('packaging icons written (desktop/build)');
