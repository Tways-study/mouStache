// Generates README graphics from the same logo/moustache geometry the app uses:
//   docs/banner.svg        hero banner (logo + wordmark + tagline)
//   docs/mascot-moods.svg  the mascot's three moods (angles match styles/app.css)
// Run: node scripts/gen-brand.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { mustacheHalves } from '../lib/brand/moustache.mjs';

const FONT = "-apple-system, 'SF Pro Display', 'Segoe UI Variable', Inter, system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

// ---- banner: public/logo.svg embedded as a nested <svg>
const logo = readFileSync('public/logo.svg', 'utf8')
  .replace(/<\?xml[^>]*>\s*/, '')
  .replace(/<title>.*?<\/title>\s*/s, '')
  .replace(/<svg [^>]*>/, '<svg x="96" y="92" width="176" height="176" viewBox="0 0 128 128">')
  .replace(/moustache-g/g, 'logo-g');

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 360" width="1280" height="360" role="img" aria-label="mouStache: your clipboard, well-groomed">
  <title>mouStache</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset="1" stop-color="#5E5CE6"/></linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="360" rx="28" fill="url(#bg)"/>
  <rect width="1280" height="360" rx="28" fill="url(#glow)"/>
  ${logo}
  <text x="312" y="188" font-family="${FONT}" font-size="86" font-weight="700" letter-spacing="-3" fill="#fff">mou<tspan fill="#CFE3FF">S</tspan>tache</text>
  <text x="316" y="236" font-family="${FONT}" font-size="30" font-weight="500" fill="#fff" fill-opacity=".92">Your clipboard, well-groomed.</text>
  <text x="316" y="282" font-family="${MONO}" font-size="20" fill="#fff" fill-opacity=".78">$ moustache ls   # code · commands · prompts · screenshots</text>
</svg>
`;
writeFileSync('docs/banner.svg', banner);

// ---- mascot moods: the two halves pivot around the centre bridge (rest 0°, happy ∓9°, droop ±16°)
const { right, left, box } = mustacheHalves();
const pivot = { x: 64, y: box.y + box.h * 0.6 };
const scale = 2.1;
const moods = [
  { label: 'Idle', sub: 'empty panel', angle: 0, color: '#3458F0' },
  { label: 'Happy', sub: 'saved', angle: -9, color: '#3458F0' },
  { label: 'Droop', sub: 'no results', angle: 16, color: '#8E8E93' },
];
const cardW = 360, cardH = 250, gap = 24;
const cards = moods
  .map((m, i) => {
    const gx = i * (cardW + gap);
    const tx = cardW / 2 - pivot.x * scale;
    const ty = 62 - box.y * scale;
    return `  <g transform="translate(${gx} 0)">
    <rect width="${cardW}" height="${cardH}" rx="20" fill="#F5F5F7" stroke="#E5E5EA"/>
    <g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale})" fill="${m.color}">
      <path d="${left}" transform="rotate(${-m.angle} ${pivot.x} ${pivot.y.toFixed(1)})"/>
      <path d="${right}" transform="rotate(${m.angle} ${pivot.x} ${pivot.y.toFixed(1)})"/>
    </g>
    <text x="${cardW / 2}" y="178" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="#1C1C1E">${m.label}</text>
    <text x="${cardW / 2}" y="208" text-anchor="middle" font-family="${MONO}" font-size="14" fill="#5B5B63">${m.sub}</text>
  </g>`;
  })
  .join('\n');
const totalW = cardW * 3 + gap * 2;
writeFileSync(
  'docs/mascot-moods.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${cardH}" width="${totalW}" height="${cardH}" role="img" aria-label="The mouStache mascot: idle, happy and drooping">
  <title>mouStache mascot moods</title>
${cards}
</svg>
`,
);
console.log('brand graphics written');
