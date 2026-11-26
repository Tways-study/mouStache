// The mouStache moustache: ONE shape shared by the toolbar icons (scripts/gen-icons.mjs), the Logo component
// and the Mascot component. Plain .mjs so the Node icon script can import it without a build step.
//
// The right half is a variable-width stroke through Catmull-Rom control points [x, y, radius]
// (normalised 0..1 across the 128-unit logo); the left half is its mirror about x = 0.5.

export const CTRL = [
  [0.50, 0.600, 0.050], [0.56, 0.612, 0.058], [0.63, 0.622, 0.052], [0.69, 0.612, 0.040],
  [0.730, 0.588, 0.028], [0.742, 0.555, 0.018], [0.728, 0.528, 0.010],
];

/** Dense centreline of the right half: [x, y, radius] triples. */
export function halfPoints() {
  const pts = [];
  const P = (i) => CTRL[Math.min(CTRL.length - 1, Math.max(0, i))];
  for (let i = 0; i < CTRL.length - 1; i++) {
    for (let k = 0; k < 12; k++) {
      const t = k / 12, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1, 2].map((c) => 0.5 * (2 * P(i)[c] + (-P(i - 1)[c] + P(i + 1)[c]) * t +
        (2 * P(i - 1)[c] - 5 * P(i)[c] + 4 * P(i + 1)[c] - P(i + 2)[c]) * t2 +
        (-P(i - 1)[c] + 3 * P(i)[c] - 3 * P(i + 1)[c] + P(i + 2)[c]) * t3)));
    }
  }
  pts.push(CTRL[CTRL.length - 1]);
  return pts;
}

export const HALF = halfPoints();

function ring(mirror) {
  const L = [], R = [];
  HALF.forEach(([x, y, r], i) => {
    const a = HALF[Math.max(0, i - 1)], b = HALF[Math.min(HALF.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const n = Math.hypot(tx, ty) || 1;
    tx /= n; ty /= n;
    L.push([x - ty * r, y + tx * r]);
    R.push([x + ty * r, y - tx * r]);
  });
  const [ex, ey, er] = HALF[HALF.length - 1], [px, py] = HALF[HALF.length - 2];
  const ang = Math.atan2(ey - py, ex - px), cap = [];
  for (let k = 1; k < 8; k++) {
    const t = ang + Math.PI / 2 - (Math.PI * k) / 8;
    cap.push([ex + Math.cos(t) * er, ey + Math.sin(t) * er]);
  }
  let pts = [...L, ...cap, ...R.reverse()];
  if (mirror) pts = pts.map(([x, y]) => [1 - x, y]).reverse();
  return pts;
}

const toPath = (pts) => 'M' + pts.map(([x, y]) => `${(x * 128).toFixed(1)} ${(y * 128).toFixed(1)}`).join('L') + 'Z';

/** Whole moustache as one SVG path in the 128-unit logo space. */
export function mustachePath() {
  return toPath(ring(false)) + toPath(ring(true));
}

/** The two halves separately (for animating them) plus the tight bounding box, all in 128-unit space. */
export function mustacheHalves() {
  const r = ring(false), l = ring(true);
  const all = [...r, ...l];
  const xs = all.map((p) => p[0] * 128), ys = all.map((p) => p[1] * 128);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    right: toPath(r),
    left: toPath(l),
    box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
  };
}
