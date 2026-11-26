import type { Classification, TagGroup } from './types';
import { TAG_META } from './tags';

/**
 * Heuristic, dependency-free classifier for IT-student clipboard text.
 *
 * Approach: cheap whole-text shape checks first (URL, email, hash, uuid, colour, timestamp,
 * base64, regex), then structural checks (error, JSON, Cisco config, shell command, prompt,
 * YAML), then weighted per-language regex scoring (best score >= 3 wins), and finally
 * network/link scanning that always runs. Analysis is capped at the first 20k chars.
 *
 * Group precedence (highest first): error > prompt > code > network > link > data > other.
 * `command`, `json`, `yaml`, `sql` and language tags belong to `code`. `secret` belongs to
 * `data`, so a text whose only signal is a secret lands in `data`.
 *
 * Known decisions: a bare dotted quad (1.2.3.4) is an `ip`; only `v1.2.3.4` / `version 1.2.3.4`
 * are treated as versions. A text that is just a URL/email is group `link` even if the host is an IP.
 */

const MAX_ANALYZE = 20000;
/**
 * Secrets are looked for in the WHOLE text (up to this many characters, the largest thing any caller classifies):
 * a key pasted after 20,000 characters of log output must still be caught. Every pattern below is therefore
 * written with bounded repetition so scanning a hostile megabyte stays linear (see classify.test.ts).
 */
const MAX_SECRET_SCAN = 1_000_000;
const MAX_TAGS = 6;
const HEAD_CAP = 4000;

const GROUP_PRECEDENCE: TagGroup[] = ['error', 'prompt', 'code', 'network', 'link', 'data', 'other'];

/** Map a tag to its display group (used by the side panel filter rail and chip colors). */
export function tagGroup(tag: string): TagGroup {
  return TAG_META[tag]?.group ?? 'other';
}

// ───────────────────────── secrets ─────────────────────────

const PLACEHOLDER = /^(?:<.*>|\*+|x{3,}|your[_-].*|\$\{?\w+\}?|%\w+%|example|placeholder|password|changeme|none|null|undefined|true|false)$/i;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?=[A-Za-z0-9_-]{0,200}\d)[A-Za-z0-9_-]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b[sr]k_live_[0-9A-Za-z]{16,}/,
  /\beyJ[A-Za-z0-9_-]{5,8192}\.eyJ[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{5,}/,
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/,
];

// password=..., "passwd": "...", pwd = '...' — value must be one token ending the line/statement
const PASSWORD_ASSIGN = /(?<![a-z])(?:password|passwd|pwd)["']?\s*[=:]\s*(["']?)([^\s"']{4,256})\1\s*(?:$|[;,&)\]}])/gim;
const KEY_ASSIGN =
  /(?<![a-z])(?:api[_-]?key|secret[_-]?(?:access[_-]?)?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[=:]\s*(["']?)([A-Za-z0-9_\-/+=.]{12,512})\1\s*(?:$|[;,&)\]}])/gim;
const RE_URL_WITH_CREDS = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/<>]{1,256}:[^\s@/<>]{1,256}@\S*/gi;
const URL_CREDS = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/<>]{1,256}:([^\s@/<>]{1,256})@[^\s/]+/i;

function detectSecret(t: string): boolean {
  for (const re of SECRET_PATTERNS) if (re.test(t)) return true;
  for (const re of [PASSWORD_ASSIGN, KEY_ASSIGN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      if (m[2] && !PLACEHOLDER.test(m[2])) return true;
    }
  }
  const u = URL_CREDS.exec(t);
  return !!u && !!u[1] && !PLACEHOLDER.test(u[1]);
}

// ───────────────────────── whole-text data shapes ─────────────────────────

const RE_URL_ONLY = /^(?:(?:https?|ftp|file|chrome|chrome-extension|ws|wss):\/\/|www\.)\S+$/i;
const RE_EMAIL_ONLY = /^[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const RE_HASH = /^(?:(?:md5|sha-?1|sha-?256|sha-?512)[:=]\s*)?(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})(?:\s+\*?\S+)?$/i;
const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const RE_HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RE_CSS_COLOR_FN = /^(?:rgba?|hsla?)\(\s*[\d.%\s,/-]+\)$/i;
const RE_ISO_TS = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?$/;
const RE_REGEX_LITERAL = /^\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[dgimsuvy]{0,7}$/;
const TLDS = 'com|net|org|io|dev|edu|gov|app|local|lan|internal|home|test|example|info|biz|co|me|ai|cloud|xyz|uk|de|fr|us|eu|ca|au|ru|cn|jp|br';

function isHexColors(t: string): boolean {
  if (RE_CSS_COLOR_FN.test(t)) return true;
  const parts = t.split(/[\s,;]+/).filter(Boolean);
  return parts.length > 0 && parts.length <= 20 && parts.every((p) => RE_HEX_COLOR.test(p));
}

function isTimestamp(t: string): boolean {
  if (/^\d{10}$/.test(t) || /^\d{13}$/.test(t)) {
    const ms = t.length === 13 ? Number(t) : Number(t) * 1000;
    return ms >= 946684800000 && ms <= 4102444800000;
  }
  return RE_ISO_TS.test(t);
}

function isBase64(t: string): boolean {
  let s = t;
  const m = /^data:[\w/+.-]+;base64,(.+)$/is.exec(t);
  if (m && m[1]) return m[1].length >= 16;
  s = t.replace(/\s+/g, '');
  if (s.length < 40 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  if (/^[0-9a-f]+$/i.test(s)) return false;
  const upper = (s.match(/[A-Z]/g) ?? []).length / s.length;
  const lower = (s.match(/[a-z]/g) ?? []).length;
  const extra = (s.match(/[0-9+/=]/g) ?? []).length;
  if (lower === 0 || upper < 0.2 || upper > 0.6 || extra < 2) return false;
  return s.length % 4 === 0 || /[+/=]/.test(s);
}

function isRegex(t: string): boolean {
  if (t.includes('\n') || t.length < 3 || t.length > 300) return false;
  if (RE_REGEX_LITERAL.test(t) && /[\\^$.*+?()[\]{}|]/.test(t.slice(1, t.lastIndexOf('/')))) return true;
  if (t.length < 4) return false;
  const spaces = (t.match(/ /g) ?? []).length;
  if (spaces > 2) return false;
  const meta = (t.match(/[\\^$.*+?()[\]{}|]/g) ?? []).length;
  if (meta / t.length < 0.3) return false;
  return /\\[dwsbDWSB.]|\[[^\]]+\][*+?{]|\(\?[:=!<]|\.[*+]|^\^.*\$$/.test(t);
}

// ───────────────────────── errors ─────────────────────────

const ERROR_PATTERNS: RegExp[] = [
  /Traceback \(most recent call last\)/,
  /^\s*(?:Uncaught\s+)?(?:[\w.$]*(?:Error|Exception)):\s/m,
  /^\s*(?:Uncaught\s+)?[\w.$]*(?:Error|Exception)\s*$/m,
  /Exception in thread\b/,
  /\bnpm ERR!/,
  /^\s*fatal:\s/m,
  /Segmentation fault/i,
  /\bHTTP\/\d(?:\.\d)?\s+[45]\d\d\b/,
  /\b[45]\d\d\s+(?:Not Found|Internal Server Error|Bad Request|Forbidden|Unauthorized|Bad Gateway|Service Unavailable|Method Not Allowed|Gateway Timeout)\b/,
  /\berror\s+TS\d+:/i,
  /\berror\[E\d{4}\]/,
  /\bUnhandled(?:Promise)?Rejection\b/,
  /\b(?:ECONNREFUSED|ENOENT|EADDRINUSE|ETIMEDOUT)\b/,
  /^\s*bash: .+: command not found/m,
  /\bCaused by: [\w.$]+/,
];
const STACK_FRAME = /^\s+at\s+[\w.$<>\s[\]]+\(.*:\d+(?::\d+)?\)|^\s+at\s+\S+:\d+:\d+|^\s+File ".*", line \d+|^\s+at\s+[\w.$]+\([\w$]+\.java:\d+\)/m;

// ───────────────────────── network ─────────────────────────

const RE_IPV4_CIDR = /(?<![\d.])(?<!\bv)(?<!version )((?:\d{1,3}\.){3}\d{1,3})(?:\/(\d{1,2}))?(?!\d|\.\d)/gi;
const RE_MAC = /(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])|\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/i;
const RE_PORT = new RegExp(
  `(?<![\\w./:@-])(?:localhost|(?:\\d{1,3}\\.){3}\\d{1,3}|(?:[a-z0-9-]+\\.)+(?:${TLDS})|\\[[0-9a-f:]+\\]):(\\d{1,5})(?![\\w:])`,
  'gi',
);
const RE_URL_ANY = /\b(?:https?|ftp|ws|wss):\/\/[^\s<>"')]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i;
const RE_EMAIL_ANY = /(?<![\w.+-])[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/;
const CISCO_LINE =
  /^\s*(?:interface\s+\S+|ip\s+address\s+\S+(?:\s+\S+)?|ip\s+route\s+.+|ip\s+(?:default-gateway|routing|dhcp\s+.+)|router\s+(?:ospf|eigrp|bgp|rip)\b.*|network\s+\d.*|no\s+shutdown|shutdown|switchport\b.*|hostname\s+\S+|enable\s+(?:secret|password)\b.*|line\s+(?:vty|con|aux)\b.*|access-list\s+.*|vlan\s+\d+|spanning-tree\b.*|configure\s+terminal|show\s+(?:ip|running-config|interfaces?|vlan|version|cdp|mac)\b.*|description\s+.*|duplex\s+\w+|speed\s+\w+|encapsulation\s+.*|ipv6\s+address\s+.*)\s*$/i;

function isValidMask(octets: number[]): boolean {
  const n = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  if (n === 0 || octets[0]! < 128) return false;
  const inv = ~n >>> 0;
  return (inv & (inv + 1)) === 0 || inv === 0xffffffff;
}

function isIPv6Token(tok: string): boolean {
  if (!/^[0-9a-f:]+$/i.test(tok) || !/\d/.test(tok)) return false;
  const colons = (tok.match(/:/g) ?? []).length;
  if (colons < 2 || colons > 7) return false;
  const compressed = tok.includes('::');
  if (!compressed && colons !== 7) return false;
  if (tok.split('::').length > 2 || tok.includes(':::')) return false;
  const groups = tok.split(':').filter(Boolean);
  if (groups.length > 8 || groups.some((g) => g.length > 4)) return false;
  return true;
}

function scanNetwork(t: string, add: (tag: string) => void, isErrorText: boolean): void {
  let ip = false;
  let cidr = false;
  let mask = false;
  RE_IPV4_CIDR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_IPV4_CIDR.exec(t))) {
    const octets = m[1]!.split('.').map(Number);
    if (octets.some((o) => o > 255)) continue;
    if (m[2] !== undefined && Number(m[2]) <= 32) cidr = true;
    else if (isValidMask(octets)) mask = true;
    else ip = true;
  }
  // IPv6 (token based)
  if (!ip && t.includes(':')) {
    for (const raw of t.split(/[\s,;()"'<>=]+/)) {
      const tok = raw.replace(/^\[|\](?::\d+)?$/g, '').replace(/\/\d{1,3}$/, '').replace(/%\w+$/, '');
      if (tok.length >= 2 && tok.length <= 45 && isIPv6Token(tok)) {
        ip = true;
        break;
      }
    }
  }
  if (ip) add('ip');
  if (cidr) add('cidr');
  if (mask) add('subnet-mask');
  if (RE_MAC.test(t)) add('mac');
  if (!isErrorText) {
    RE_PORT.lastIndex = 0;
    while ((m = RE_PORT.exec(t))) {
      const p = Number(m[1]);
      if (p >= 1 && p <= 65535) {
        add('port');
        break;
      }
    }
  }
}

// ───────────────────────── shell commands ─────────────────────────

const CMD_WORDS = new Set(
  (
    'git npm npx pnpm yarn pip pip3 python python3 py node deno bun docker docker-compose kubectl helm terraform ansible ssh scp sftp rsync ' +
    'cd ls cat grep egrep sed awk sudo apt apt-get yum dnf brew pacman curl wget ping ipconfig ifconfig nmap netstat traceroute tracert ' +
    'nslookup dig chmod chown mkdir rmdir rm cp mv touch systemctl service journalctl cargo rustc go java javac gcc g++ clang make mvn gradle ' +
    'tar unzip zip ps kill top htop df du free whoami hostname uname man tail head sort uniq wc find xargs mount umount ssh-keygen openssl ' +
    'ip arp route netsh nc telnet tcpdump iptables ufw echo export source set dir cls type copy del ren mklink choco winget code vim nano psql mysql sqlite3 ' +
    'flask django-admin uvicorn pytest tsc vite jest vitest php composer dotnet nuget'
  ).split(' '),
);
/** Words that are ordinary English; "<cmd> <prose>" is not a command. */
const PROSE_STOP = new Set(
  'is are was were the a an your my to you and of for it this that with before after on in at be can will has have do does not or but if as from by about me up out into than then so what how why when'.split(
    ' ',
  ),
);
const PS_ONLY = new Set(['ipconfig', 'tracert', 'netsh', 'cls', 'dir', 'del', 'ren', 'copy', 'type', 'mklink', 'choco', 'winget']);
const PS_CMDLET = /^[A-Z][a-z]+-[A-Z][A-Za-z]+$/;
const PS_PROMPT = /^PS [A-Za-z]:\\[^>]*>\s?/;
const SH_PROMPT = /^(?:\$|%|>)\s+/;

function commandLine(raw: string): { ok: boolean; ps: boolean } {
  let line = raw.trim();
  let ps = false;
  let prompted = false;
  if (PS_PROMPT.test(line)) {
    line = line.replace(PS_PROMPT, '');
    ps = true;
    prompted = true;
  } else if (SH_PROMPT.test(line)) {
    line = line.replace(SH_PROMPT, '');
    prompted = true;
  }
  const toks = line.split(/\s+/);
  let i = 0;
  while (toks[i] === 'sudo' || toks[i] === 'time') i++;
  const first = toks[i];
  if (!first) return { ok: false, ps };
  const rest = toks.slice(i + 1);
  const isCmdlet = PS_CMDLET.test(first);
  if (!CMD_WORDS.has(first) && !isCmdlet) return { ok: false, ps };
  if (isCmdlet) ps = true;
  if (PS_ONLY.has(first)) ps = true;
  if (rest.length === 0 && !prompted && !isCmdlet && first !== 'ipconfig' && first !== 'ifconfig' && first !== 'netstat') {
    return { ok: false, ps };
  }
  // ambiguous words need a command-looking argument
  if (['go', 'ip', 'make', 'type', 'copy', 'set', 'source', 'dir', 'service', 'code', 'top', 'free', 'find', 'sort', 'head', 'man', 'route', 'mount'].includes(first)) {
    const arg = rest[0] ?? '';
    const looksCmd = /^(?:-|\/|\.|~|\$|["'])/.test(arg) || /^(?:run|build|get|mod|test|install|fmt|version|addr|link|neigh|a|r|all|clean|-)$/.test(arg);
    if (!looksCmd) return { ok: false, ps };
  }
  // prose guard: stop words outside quoted strings
  const unquoted = rest.join(' ').replace(/"[^"]*"|'[^']*'/g, ' ');
  const words = unquoted.split(/\s+/).filter(Boolean);
  if (words.some((w) => PROSE_STOP.has(w.toLowerCase())) && !/[|&;<>=/\\$-]/.test(unquoted)) return { ok: false, ps };
  if (/[.!?]$/.test(line) && /^[a-z]+(?: [a-z]+){4,}[.!?]$/i.test(line)) return { ok: false, ps };
  return { ok: true, ps };
}

function detectCommand(t: string): { lang: 'bash' | 'powershell' } | null {
  if (/^#!/.test(t)) return null;
  const lines = t.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '' && !/^\s*#(?!!)/.test(l));
  if (lines.length === 0 || lines.length > 60) return null;
  let cmds = 0;
  let cont = 0;
  let ps = false;
  let prevContinues = false;
  for (const l of lines) {
    const r = commandLine(l);
    if (r.ok) {
      cmds++;
      if (r.ps) ps = true;
    } else if (prevContinues || /^\s*(?:\||&&|\|\||-{1,2}\w)/.test(l)) {
      cont++;
    }
    prevContinues = /(?:\\|\^|`)\s*$/.test(l);
  }
  if (cmds === 0 || (cmds + cont) / lines.length < 0.7) return null;
  return { lang: ps ? 'powershell' : 'bash' };
}

// ───────────────────────── code language scoring ─────────────────────────

type Rule = [RegExp, number];
const LANG_ORDER = ['typescript', 'javascript', 'python', 'java', 'csharp', 'cpp', 'c', 'sql', 'html', 'css', 'powershell', 'bash', 'go', 'rust', 'php'] as const;

const RULES: Record<string, Rule[]> = {
  python: [
    [/^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[\w[\], .|]+)?\s*:/m, 4],
    [/^\s*class\s+\w+(?:\([\w., ]*\))?\s*:/m, 4],
    [/^\s*(?:from\s+[\w.]+\s+import\s+[\w*, ()]+|import\s+[\w.]+(?:\s+as\s+\w+)?)\s*$/m, 2],
    [/^\s*(?:elif\b.*:|else:|try:|except(?:\s+[\w.]+)?(?:\s+as\s+\w+)?:|finally:)\s*$/m, 2],
    [/^\s*(?:for\s+\w+(?:,\s*\w+)*\s+in\s+.+|while\s+.+|if\s+.+|with\s+.+\s+as\s+\w+):\s*$/m, 2],
    [/\bprint\(/, 2],
    [/^\s*print\((?:f?["'].*["']|\w+)\)\s*$/m, 3],
    [/^\s*import\s+\w+\s+as\s+\w+\s*$/m, 2],
    [/\bself\.\w+/, 1],
    [/__name__\s*==\s*['"]__main__['"]/, 4],
    [/\blambda\s*\w*\s*:/, 2],
    [/\b(?:True|False|None)\b/, 0.5],
  ],
  javascript: [
    [/\b(?:const|let|var)\s+[\w${}[\],\s]+?\s*=/, 2],
    [/=>/, 1.5],
    [/\bfunction\s*\w*\s*\(/, 2.5],
    [/\bconsole\.(?:log|error|warn|info)\(/, 3],
    [/\brequire\(\s*['"]/, 3],
    [/^\s*import\s[^;\n]*\sfrom\s+['"][^'"]+['"]/m, 3.5],
    [/^\s*export\s+(?:default|const|function|class|async)\b/m, 3.5],
    [/\b(?:document|window)\.\w+/, 2],
    [/===|!==/, 1.5],
    [/\.(?:then|catch)\(/, 1.5],
    [/\bawait\s+\w+/, 1.5],
    [/\bnew Promise\(/, 2],
  ],
  java: [
    [/\bpublic\s+(?:static\s+)?(?:final\s+)?(?:void|class|int|String|boolean|double)\b/, 3],
    [/System\.out\.print(?:ln)?\(/, 4],
    [/\bimport\s+java\.\w+/, 4],
    [/\bString\[\]\s+args/, 3],
    [/@(?:Override|Autowired|Test)\b/, 2.5],
    [/\b(?:private|protected)\s+(?:static\s+)?(?:final\s+)?\w+(?:<[^>]*>)?\s+\w+\s*[=;(]/, 2],
    [/\bthrows\s+\w+/, 2],
    [/\bnew\s+\w+(?:<[^>]*>)?\(/, 1],
  ],
  csharp: [
    [/^\s*using\s+System(?:\.\w+)*;/m, 4],
    [/\bConsole\.(?:WriteLine|Write|ReadLine)\(/, 4],
    [/\bnamespace\s+[\w.]+\s*(?:\{|;|\n)/, 3],
    [/\{\s*get;\s*(?:set;|private set;|init;)?\s*\}/, 4],
    [/\bstatic\s+(?:void|async Task)\s+Main\s*\(/, 4],
    [/\bvar\s+\w+\s*=\s*new\b/, 2],
    [/\[(?:HttpGet|HttpPost|Fact|TestMethod|Serializable)\b/, 3],
    [/\bforeach\s*\(\s*var\b/, 3],
    [/\basync\s+Task\b/, 3],
  ],
  c: [
    [/^\s*#include\s*<\w+\.h>/m, 4],
    [/^\s*#include\s*"[\w./]+\.h"/m, 3],
    [/\bint\s+main\s*\(/, 3],
    [/\bprintf\s*\(/, 2.5],
    [/\bscanf\s*\(/, 2.5],
    [/\b(?:malloc|free|sizeof)\s*\(/, 2],
    [/\bstruct\s+\w+\s*\{/, 2],
    [/\b(?:char|int)\s*\*+\s*\w+/, 1.5],
    [/^\s*#define\s+\w+/m, 2],
    [/\breturn\s+0;/, 1],
  ],
  cpp: [
    [/^\s*#include\s*<(?:iostream|vector|string|map|set|algorithm|memory|fstream|sstream|cmath|queue|stack|unordered_map|cstdio)>/m, 5],
    [/\bstd::\w+/, 3],
    [/\b(?:cout|cin)\s*(?:<<|>>)/, 3],
    [/\busing\s+namespace\s+std\b/, 4],
    [/\btemplate\s*<\s*(?:typename|class)\b/, 3],
    [/\bnullptr\b/, 2],
  ],
  sql: [
    [/\bSELECT\b[\s\S]{1,300}?\bFROM\b\s+[\w.`"[\]]+/, 4],
    [/\bselect\s+\*\s+from\s+\w+/i, 4],
    [/\bselect\s+[\w., ]+\s+from\s+\w+\s+(?:where|join|group by|order by|limit|inner|left)\b/i, 4],
    [/\bselect\s+[\w., ]+\s+from\s+\w+\s*;/i, 4],
    [/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|DATABASE|INDEX|VIEW|PROCEDURE)|ALTER\s+TABLE|DROP\s+(?:TABLE|DATABASE))\b/, 4],
    [/\binsert\s+into\s+\w+\s*(?:\(|values|select)/i, 4],
    [/\bcreate\s+table\s+\w+\s*\(/i, 4],
    [/\bdelete\s+from\s+\w+\s+where\b/i, 4],
    [/\bupdate\s+\w+\s+set\s+\w+\s*=/i, 4],
    [/\b(?:WHERE|GROUP BY|ORDER BY|JOIN|HAVING)\b/, 1.5],
    [/\bVARCHAR\s*\(\d+\)|\bPRIMARY KEY\b|\bNOT NULL\b/, 2],
  ],
  css: [
    [/(?:^|[\s,}])[.#:@]?[\w-]+(?:\s*[>+~,]\s*[.#:]?[\w-]+)*\s*\{\s*[\w-]+\s*:\s*[^;{}]+;/, 4],
    [/@media\b[^{]+\{/, 4],
  ],
  powershell: [
    [/\$env:\w+/i, 4],
    [/\b(?:Get|Set|New|Remove|Write|Select|Where|ForEach|Invoke|Start|Stop|Import|Export|Test|Out|Add|Clear|Copy|Move|Rename)-[A-Z][A-Za-z]+\b/, 4],
    [/^\s*\$\w+\s*=/m, 1],
    [/\s-(?:eq|ne|gt|lt|ge|le|like|match|contains)\s/i, 2],
    [/^PS\s+[A-Za-z]:\\.*>/m, 5],
    [/\|\s*(?:Where-Object|ForEach-Object|Select-Object|Sort-Object|Format-Table)/, 3],
    [/\bparam\s*\(/i, 2],
  ],
  bash: [
    [/^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z)?sh/m, 6],
    [/\bif\s+\[\[?\s.*\]\]?\s*;\s*then\b/, 4],
    [/^\s*fi\s*$/m, 2],
    [/\bfor\s+\w+\s+in\s+.*;\s*do\b/, 4],
    [/\$\(\s*[a-z]/, 2],
    [/^\s*export\s+\w+=/m, 3],
    [/\becho\s+["'$]/, 2],
    [/\|\s*(?:grep|awk|sed|sort|wc|xargs|head|tail)\b/, 3],
    [/^\s*(?:chmod|chown|mkdir|sudo)\s/m, 1.5],
  ],
  go: [
    [/^\s*package\s+\w+\s*$/m, 4],
    [/^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/m, 4],
    [/\bfmt\.(?:Print|Sprintf|Println|Errorf|Fprintf)/, 4],
    [/:=/, 2],
    [/^\s*import\s*\(\s*$/m, 3],
    [/\bgo\s+func\s*\(/, 3],
    [/\bdefer\s+\w+/, 2],
    [/\berr\s*!=\s*nil\b/, 4],
  ],
  rust: [
    [/\bfn\s+main\s*\(\s*\)/, 5],
    [/\bfn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->\s*[\w<>&[\]:, ']+)?\s*\{/, 4],
    [/\blet\s+mut\s+\w+/, 4],
    [/\b(?:println|print|vec|format|panic|assert_eq|assert)!\s*[([]/, 4],
    [/\buse\s+(?:std|crate|super|self)::/, 4],
    [/\b(?:impl|pub struct|pub enum|pub fn|trait)\s+\w+/, 3],
    [/\b&(?:mut\s+)?self\b/, 3],
    [/#\[derive\(/, 4],
  ],
  php: [
    [/<\?php/, 6],
    [/<\?=/, 3],
    [/\$\w+\s*->\s*\w+/, 2.5],
    [/\bfunction\s+\w+\s*\(\s*\$\w+/, 3],
    [/\becho\s+[^;\n]+;/, 2],
    [/\$_(?:GET|POST|SERVER|SESSION|REQUEST)\b/, 4],
    [/\$this->/, 3],
    [/\$\w+\s*=[^=][^;\n]*;/, 1.5],
  ],
};

const TS_RULES: Rule[] = [
  [/\binterface\s+\w+\s*(?:<[^>]*>)?\s*(?:extends\s+[\w, <>]+)?\{[\s\S]*?\w+\??:\s*\w+/, 4],
  [/\btype\s+\w+(?:<[^>]*>)?\s*=\s*[\w{|'"([]/, 3],
  [/:\s*(?:string|number|boolean|any|void|unknown|never)(?:\[\])?\s*[,;)=\n{]/, 2.5],
  [/\bimport\s+type\b/, 4],
  [/\bas\s+(?:const|string|number|any|unknown)\b/, 2],
  [/\w+\?:\s*\w+/, 3],
  [/\benum\s+\w+\s*\{/, 2],
];

function scoreRules(t: string, rules: Rule[]): number {
  let s = 0;
  for (const [re, w] of rules) if (re.test(t)) s += w;
  return s;
}

function htmlScore(t: string): number {
  if (/<!DOCTYPE\s+html/i.test(t)) return 5;
  const m = t.match(/<\/?(?:div|span|html|head|body|p|ul|ol|li|h[1-6]|table|tr|td|form|input|button|script|style|section|nav|header|footer|main|a|img|link|meta|title|br)\b[^>]*>/gi);
  if (!m) return 0;
  return m.length >= 2 ? 4 : 2.5;
}

function cssDecls(t: string): number {
  const m = t.match(/^\s*[a-z-]+\s*:\s*[^;\n{}]+;\s*$/gm);
  return m && m.length >= 3 ? 3 : 0;
}

function detectLang(t: string): { lang: string; score: number } | null {
  const scores: Record<string, number> = {};
  for (const lang of Object.keys(RULES)) scores[lang] = scoreRules(t, RULES[lang]!);
  scores.html = htmlScore(t);
  scores.css = (scores.css ?? 0) + cssDecls(t);
  const tsOnly = scoreRules(t, TS_RULES);
  scores.typescript = tsOnly >= 2.5 ? tsOnly + (scores.javascript ?? 0) : 0;
  let best: string | null = null;
  let bestScore = 0;
  for (const lang of LANG_ORDER) {
    const s = scores[lang] ?? 0;
    if (s > bestScore) {
      best = lang;
      bestScore = s;
    }
  }
  if (!best || bestScore < 3) return null;
  return { lang: best, score: bestScore };
}

// ───────────────────────── yaml ─────────────────────────

function isYaml(t: string): boolean {
  const lines = t.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '' && !/^\s*#/.test(l) && l.trim() !== '---');
  if (lines.length < 2) return false;
  let keys = 0;
  let structural = /^---\s*$/m.test(t);
  let ok = 0;
  for (const l of lines) {
    const km = /^(\s*)(-\s+)?([a-z_][\w.-]*|[a-z][\w-]*[A-Z]\w*):(?:\s+(.*))?$/.exec(l);
    if (km) {
      ok++;
      keys++;
      if (km[1] || km[2]) structural = true;
      const val = km[4] ?? '';
      if (/^[^"'[{]*(?:[A-Za-z]+\s+){5,}/.test(val + ' ')) return false; // prose value
    } else if (/^\s*-\s+\S/.test(l) || /^\s+\S/.test(l)) {
      ok++;
      structural = true;
    }
  }
  return keys >= 2 && ok / lines.length >= 0.75 && (structural || keys >= 3);
}

// ───────────────────────── prompts ─────────────────────────

const FENCE_RE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
const FENCE_LANG: Record<string, string> = {
  py: 'python', python: 'python', js: 'javascript', javascript: 'javascript', jsx: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp',
  cs: 'csharp', csharp: 'csharp', 'c#': 'csharp', sql: 'sql', html: 'html', css: 'css', bash: 'bash', sh: 'bash',
  shell: 'bash', zsh: 'bash', powershell: 'powershell', ps1: 'powershell', pwsh: 'powershell', json: 'json',
  yaml: 'yaml', yml: 'yaml', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', php: 'php',
};

const PROMPT_STRONG: RegExp[] = [
  /\b(?:act|behave|respond|reply) as (?:an? |the )?\w+/i,
  /\byou(?:'re| are) (?:an?|the|my|now|going to|expected to|responsible)\b/i,
  /\byour (?:task|job|goal|role) is\b/i,
  /\b(?:pretend|imagine) (?:to be|you|that you)\b/i,
  /\{\{\s*[\w. -]+\s*\}\}|\[(?:INSERT|YOUR)[^\]]*\]/i,
  /^#{1,4}\s*(?:instructions?|task|context|role|rules|constraints|requirements|output format|examples?)\b/im,
  /\bstep[- ]by[- ]step\b/i,
  /\b(?:rewrite|rephrase|summari[sz]e|translate|paraphrase|proofread|critique|review|analy[sz]e) (?:the|this|these|my|following|below|it)\b/i,
  /\bthe following (?:text|code|article|passage|paragraph|email|essay|function|error|snippet|sentence)s?\b/i,
  /\bI (?:want|need|would like|'d like) you to\b/i,
  /\b(?:do not|don't|never|always|make sure|ensure) (?:include|use|mention|add|output|return|answer|respond|reply|explain|write)\b/i,
];
const PROMPT_IMPERATIVE =
  /(?:^|[.!?:]\s+|\n)\s*(?:please\s+)?(?:explain|write|generate|create|summari[sz]e|describe|list|give|show|help|make|draft|compose|translate|convert|fix|debug|refactor|optimi[sz]e|compare|suggest|outline|brainstorm|design|implement|review|analy[sz]e|tell|provide|come up with|can you|could you|would you)\b/i;
const PROMPT_START_IMPERATIVE =
  /^\s*(?:please\s+)?(?:explain|write|generate|create|summari[sz]e|describe|list|give|show|help|make|draft|compose|translate|convert|fix|debug|refactor|optimi[sz]e|compare|suggest|outline|brainstorm|design|implement|review|analy[sz]e|tell|provide|can you|could you|would you)\b/i;
const PROMPT_MODIFIER =
  /\b(?:in simple terms|in plain (?:english|terms)|for (?:a )?beginners?|for a [\w-]+ ?[\w-]* student|eli5|with examples?|bullet points?|as a table|in a table|in markdown|in json|word limit|under \d+ words|\d+ (?:words|sentences|paragraphs|bullets?)|tone|concise|in detail)\b/i;

function stripForPrompt(t: string): string {
  return t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ');
}

function isPrompt(t: string): boolean {
  if (t.length < 80) return false;
  const s = stripForPrompt(t);
  if (s.trim().length < 40) return false;
  const syms = (s.match(/[{}[\];=<>$\\|]/g) ?? []).length;
  if (syms / s.length > 0.04) return false;
  if (t.split(/\s+/).length < 12) return false;
  let score = 0;
  for (const re of PROMPT_STRONG) if (re.test(t)) score += 2;
  if (PROMPT_START_IMPERATIVE.test(s)) score += 2;
  else if (PROMPT_IMPERATIVE.test(s)) score += 1;
  if (PROMPT_MODIFIER.test(s)) score += 1;
  return score >= 3;
}

// ───────────────────────── main ─────────────────────────

export function classify(input: string): Classification {
  const text = input.length > MAX_ANALYZE ? input.slice(0, MAX_ANALYZE) : input;
  const t = text.trim();
  if (!t) return { tags: [], secret: false, group: 'other' };

  const tags: string[] = [];
  const add = (tag: string): void => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  let lang: string | undefined;

  // heavy structural heuristics only look at the head of long texts (perf); secrets/network scan everything
  const head = t.length > HEAD_CAP ? t.slice(0, HEAD_CAP) : t;
  // secrets: the whole input, not just the analysed head
  const secret = detectSecret(input.length > MAX_SECRET_SCAN ? input.slice(0, MAX_SECRET_SCAN) : input);
  if (secret) add('secret');

  const finish = (): Classification => {
    const out = tags.slice(0, MAX_TAGS);
    const groups = new Set(out.map(tagGroup));
    let group: TagGroup = 'other';
    for (const g of GROUP_PRECEDENCE) {
      if (groups.has(g)) {
        group = g;
        break;
      }
    }
    const res: Classification = { tags: out, secret, group };
    if (lang) res.lang = lang;
    return res;
  };

  // single-token shapes (early return)
  if (!t.includes('\n') || t.length < 400) {
    if (RE_URL_ONLY.test(t)) {
      add('url');
      return finish();
    }
    if (RE_EMAIL_ONLY.test(t)) {
      add('email');
      return finish();
    }
  }
  if (RE_HASH.test(t)) {
    add('hash');
    return finish();
  }
  if (!secret) {
    if (RE_UUID.test(t) && t.replace(RE_UUID, '').trim() === '') {
      add('uuid');
      return finish();
    }
    if (isHexColors(t)) {
      add('hex-color');
      return finish();
    }
    if (isTimestamp(t)) {
      add('timestamp');
      return finish();
    }
    if (isBase64(t)) {
      add('base64');
      return finish();
    }
    if (isRegex(t)) {
      add('regex');
      return finish();
    }
  }

  // errors
  const isError = ERROR_PATTERNS.some((re) => re.test(t));
  if (isError) {
    add('error');
    if (STACK_FRAME.test(t) || /Traceback \(most recent call last\)|Exception in thread/.test(t)) add('stack-trace');
    scanNetwork(t, add, true);
    return finish();
  }

  // JSON
  let handled = false;
  if (/^[[{]/.test(t) && /[\]}]$/.test(t)) {
    try {
      const v: unknown = JSON.parse(t);
      if (typeof v === 'object' && v !== null) {
        add('code');
        add('json');
        lang = 'json';
        handled = true;
      }
    } catch {
      /* not JSON */
    }
  }

  // Cisco IOS config
  if (!handled) {
    const lines = t.split('\n').filter((l) => l.trim() !== '' && !/^\s*!/.test(l));
    const hits = lines.filter((l) => CISCO_LINE.test(l)).length;
    if (hits >= 2 && hits / lines.length >= 0.6) {
      add('cisco');
      handled = true;
    }
  }

  // shell commands
  if (!handled) {
    const cmd = detectCommand(head);
    if (cmd) {
      add('command');
      lang = cmd.lang;
      handled = true;
    }
  }

  // prompts (may also carry a fenced code block)
  if (!handled && isPrompt(head)) {
    add('prompt');
    FENCE_RE.lastIndex = 0;
    const fm = FENCE_RE.exec(t);
    if (fm) {
      const label = (fm[1] ?? '').toLowerCase();
      const l = FENCE_LANG[label] ?? detectLang(fm[2] ?? '')?.lang;
      add('code');
      if (l) {
        lang = l;
        add(l);
      }
    }
    handled = true;
  }

  // code languages / yaml
  if (!handled) {
    const d = detectLang(head);
    if (d) {
      lang = d.lang;
      add('code');
      add(d.lang);
      handled = true;
    } else if (isYaml(head)) {
      add('code');
      add('yaml');
      lang = 'yaml';
      handled = true;
    }
  }

  // network + links always scanned (cheap)
  scanNetwork(t, add, false);
  if (RE_URL_ANY.test(t.replace(RE_URL_WITH_CREDS, ' '))) add('url');
  if (RE_EMAIL_ANY.test(t.replace(RE_URL_WITH_CREDS, ' ')) && !tags.includes('code') && !tags.includes('command')) add('email');
  if (RE_UUID.test(t)) add('uuid');

  return finish();
}
