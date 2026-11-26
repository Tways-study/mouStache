import type { StashItem } from '@/lib/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function gradientBlob(w: number, h: number, stops: [string, string], label?: string): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(1, stops[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // faux UI chrome so screenshots read as screenshots
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, 0, w, h * 0.09);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fillRect(w * 0.06, h * 0.22, w * 0.5, h * 0.06);
  g.fillRect(w * 0.06, h * 0.34, w * 0.36, h * 0.05);
  g.fillRect(w * 0.06, h * 0.45, w * 0.44, h * 0.05);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(w * 0.06, h * 0.62, w * 0.88, h * 0.26);
  if (label) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = `600 ${Math.round(h * 0.07)}px sans-serif`;
    g.fillText(label, w * 0.08, h * 0.76);
  }
  return new Promise((res) => c.toBlob((b) => res(b ?? new Blob()), 'image/png'));
}

let n = 0;
function base(partial: Partial<StashItem> & Pick<StashItem, 'kind'>, ageMs: number): StashItem {
  n += 1;
  const at = Date.now() - ageMs;
  return {
    id: `demo-${n}`,
    tags: [],
    pinned: false,
    secret: false,
    hash: `demo-hash-${n}`,
    createdAt: at,
    updatedAt: at,
    via: 'copy',
    ...partial,
  };
}

export async function buildDemoItems(): Promise<StashItem[]> {
  n = 0;
  const [shotA, shotB, shotC] = await Promise.all([
    gradientBlob(1920, 1080, ['#4f46e5', '#06b6d4'], 'Wireshark — tcp.port == 443'),
    gradientBlob(1440, 900, ['#f97316', '#ec4899'], 'VS Code — main.py'),
    gradientBlob(1280, 720, ['#10b981', '#3b82f6'], 'Topology — Packet Tracer'),
  ]);
  const gh = { url: 'https://github.com/pallets/flask', title: 'pallets/flask', favicon: undefined };
  const items: StashItem[] = [
    base(
      {
        kind: 'text',
        text: 'def fib(n: int, memo: dict[int, int] | None = None) -> int:\n    """Memoised Fibonacci."""\n    memo = memo or {}\n    if n < 2:\n        return n\n    if n not in memo:\n        memo[n] = fib(n - 1, memo) + fib(n - 2, memo)\n    return memo[n]\n\nprint([fib(i) for i in range(10)])',
        tags: ['python', 'code'],
        lang: 'python',
        pinned: true,
        source: { url: 'https://docs.python.org/3/library/functools.html', title: 'functools' },
      },
      2 * DAY,
    ),
    base(
      {
        kind: 'text',
        text: 'nmap -sS -sV -p- -T4 --min-rate 1000 -oA scan 10.10.11.42',
        tags: ['command', 'bash', 'ip'],
        lang: 'bash',
        pinned: true,
        source: { url: 'https://app.hackthebox.com/machines', title: 'Hack The Box' },
      },
      5 * DAY,
    ),
    base(
      {
        kind: 'text',
        text: 'SELECT c.name, COUNT(e.id) AS enrolments\nFROM courses c\nLEFT JOIN enrolments e ON e.course_id = c.id\nWHERE c.semester = \'2026S1\'\nGROUP BY c.name\nHAVING COUNT(e.id) > 20\nORDER BY enrolments DESC;',
        tags: ['sql', 'code'],
        lang: 'sql',
        source: { url: 'https://dbfiddle.uk', title: 'db<>fiddle' },
      },
      4 * MIN,
    ),
    base(
      {
        kind: 'image',
        imageBlob: shotA,
        thumbBlob: shotA,
        width: 1920,
        height: 1080,
        mime: 'image/png',
        tags: ['screenshot', 'image'],
        via: 'screenshot',
        source: { url: 'https://wireshark.org', title: 'Wireshark' },
      },
      11 * MIN,
    ),
    base(
      {
        kind: 'text',
        text: 'Get-NetTCPConnection -State Listen |\n  Select-Object LocalAddress, LocalPort, OwningProcess |\n  Sort-Object LocalPort',
        tags: ['powershell', 'command', 'code'],
        lang: 'powershell',
      },
      26 * MIN,
    ),
    base(
      {
        kind: 'text',
        text: 'You are a senior {{role}}. Explain {{topic}} to a second-year student using one analogy and one code example. Keep it under 200 words and end with a 3-question quiz.',
        tags: ['prompt'],
        source: { url: 'https://claude.ai/new', title: 'Claude' },
      },
      50 * MIN,
    ),
    base(
      {
        kind: 'text',
        text: '{\n  "name": "stash",\n  "version": "0.1.0",\n  "scripts": { "build": "wxt build", "test": "vitest run" },\n  "dependencies": { "react": "^18.3.1", "dexie": "^4.4.7" }\n}',
        tags: ['json', 'code'],
        lang: 'json',
        source: { url: 'https://github.com/org/stash/blob/main/package.json', title: 'package.json' },
      },
      2 * HOUR,
    ),
    base(
      {
        kind: 'link',
        text: 'https://github.com/pallets/flask/blob/main/src/flask/app.py#L1123',
        tags: ['url', 'link'],
        source: gh,
      },
      3 * HOUR,
    ),
    base(
      {
        kind: 'text',
        text: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        tags: ['secret'],
        secret: true,
        via: 'paste',
        source: { url: 'https://console.aws.amazon.com/iam', title: 'IAM' },
      },
      5 * HOUR,
    ),
    base(
      {
        kind: 'text',
        text: '192.168.10.0/24 — VLAN 10 (Students)\nGateway 192.168.10.1, DHCP .50–.200',
        tags: ['cidr', 'ip'],
      },
      9 * HOUR,
    ),
    base(
      {
        kind: 'text',
        text: 'Traceback (most recent call last):\n  File "app.py", line 42, in <module>\n    main()\n  File "app.py", line 37, in main\n    user = users[idx]\nIndexError: list index out of range',
        tags: ['stack-trace', 'error', 'python'],
        lang: 'python',
      },
      DAY + 2 * HOUR,
    ),
    base(
      {
        kind: 'image',
        imageBlob: shotB,
        thumbBlob: shotB,
        width: 1440,
        height: 900,
        mime: 'image/png',
        tags: ['screenshot', 'image'],
        via: 'paste',
      },
      DAY + 5 * HOUR,
    ),
    base({ kind: 'text', text: '#0a84ff', tags: ['hex-color'] }, 3 * DAY),
    base(
      {
        kind: 'image',
        imageBlob: shotC,
        thumbBlob: shotC,
        width: 1280,
        height: 720,
        mime: 'image/png',
        tags: ['screenshot', 'image'],
        via: 'screenshot',
      },
      12 * DAY,
    ),
    base(
      {
        kind: 'text',
        text: 'git rebase -i HEAD~4 && git push --force-with-lease origin feature/auth',
        tags: ['command', 'bash'],
        lang: 'bash',
      },
      14 * DAY,
    ),
  ];
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

// ───────── ?many=1: a long-term-use library (~1,500 items) to exercise virtualisation ─────────
const GEN_COMMANDS = [
  'docker compose up -d --build', 'kubectl get pods -n {n} -o wide', 'git log --oneline --graph -n {n}', 'ssh -L {p}:localhost:{p} user@10.0.{n}.5',
  'pip install -r requirements.txt', 'npm run build -- --mode production', 'chmod +x ./deploy-{n}.sh && ./deploy-{n}.sh', 'grep -rn "TODO" src/ | wc -l',
  'tar -czf backup-{n}.tar.gz ./data', 'curl -sS https://api.example.com/v{n}/users | jq ".[0]"', 'nmap -sV -p 1-{p} 192.168.{n}.0/24',
];
const GEN_CODE = [
  'SELECT u.name, COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.created_at > NOW() - INTERVAL \'{n} days\'\nGROUP BY u.name\nORDER BY orders DESC\nLIMIT 10;',
  'def solve_{n}(nums: list[int], target: int) -> list[int]:\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n    return []',
  'const res = await fetch(`/api/items/${id}`, { headers: { Authorization: `Bearer ${token}` } });\nif (!res.ok) throw new Error(`HTTP ${res.status}`);\nconst data = await res.json();\nconsole.log(data.items.length, {n});',
  'public static int gcd(int a, int b) {\n    return b == 0 ? a : gcd(b, a % b);\n} // exercise {n}',
  'fn main() {\n    let v: Vec<u32> = (1..={n}).collect();\n    println!("{:?}", v.iter().sum::<u32>());\n}',
];
const GEN_PROSE = [
  'Explain the difference between TCP and UDP as if I am preparing for exam question {n}, with one real-world example each.',
  'Lecture {n}: normalisation removes redundancy; 3NF requires every non-key attribute to depend on the key, the whole key and nothing but the key.',
  'Meeting notes: group project sprint {n} — API contract agreed, auth service owner is Priya, demo on Thursday 14:00 in lab 2.',
  'Subnet cheat: /{p} gives 2^(32-{p}) addresses; usable hosts are that minus 2. Network + broadcast are reserved.',
  'Write a {{language}} function that {{task}} and include unit tests. Explain the time complexity in one paragraph.',
];
const GEN_ERRORS = [
  'TypeError: Cannot read properties of undefined (reading \'map\') at render (App.tsx:{n}:12)',
  'Traceback (most recent call last):\n  File "main.py", line {n}, in <module>\n    result = compute(data)\nZeroDivisionError: division by zero',
  'fatal: refusing to merge unrelated histories (attempt {n})',
  'ERROR 1045 (28000): Access denied for user \'root\'@\'localhost\' (using password: YES)',
];
const GEN_LINKS = [
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch?page={n}',
  'https://stackoverflow.com/questions/{n}0000/how-do-i-undo-the-most-recent-local-commits-in-git',
  'https://www.cloudflare.com/learning/ddos/glossary/tcp-ip/#section-{n}',
  'https://github.com/vitejs/vite/issues/{n}',
  'https://docs.docker.com/compose/compose-file/05-services/',
];

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

/** The hand-written demo set plus ~1,500 generated items spread over ~4 months. */
export async function buildManyDemoItems(count = 1500): Promise<StashItem[]> {
  const { classify } = await import('../classify');
  const base = await buildDemoItems();
  const shots = base.filter((i) => i.kind === 'image');
  const rnd = lcg(42);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const fill = (t: string) => t.replaceAll('{n}', String(2 + Math.floor(rnd() * 240))).replaceAll('{p}', String(8 + Math.floor(rnd() * 24)));
  const out: StashItem[] = [...base];
  for (let k = 0; k < count; k++) {
    // 10% from the last day, then a long tail out to ~120 days (so "Earlier" is large)
    const ageMs = rnd() < 0.1 ? rnd() * DAY : Math.pow(rnd(), 1.6) * 120 * DAY + 0.5 * DAY;
    const r = rnd();
    n += 1;
    if (r < 0.03 && shots.length) {
      const s = pick(shots);
      out.push({ ...s, id: `gen-${k}`, hash: `gen-hash-${k}`, createdAt: Date.now() - ageMs, updatedAt: Date.now() - ageMs, pinned: false, via: 'screenshot' });
      continue;
    }
    const text = fill(r < 0.28 ? pick(GEN_COMMANDS) : r < 0.5 ? pick(GEN_CODE) : r < 0.7 ? pick(GEN_PROSE) : r < 0.8 ? pick(GEN_ERRORS) : pick(GEN_LINKS)) + (rnd() < 0.5 ? '' : ` #${k}`);
    const c = classify(text);
    out.push({
      id: `gen-${k}`,
      kind: /^https?:\/\/\S+$/.test(text) ? 'link' : 'text',
      text,
      tags: c.tags,
      lang: c.lang,
      secret: c.secret,
      pinned: k % 400 === 0,
      hash: `gen-hash-${k}`,
      createdAt: Date.now() - ageMs,
      updatedAt: Date.now() - ageMs,
      via: 'copy',
      source: rnd() < 0.5 ? { url: pick(['https://stackoverflow.com/q', 'https://github.com/org/repo', 'https://docs.python.org/3/', 'https://canvas.uni.edu/course']) } : undefined,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
