import type { TagGroup } from './types';

/** Display metadata for every tag the classifier (or UI) can emit. */
export const TAG_META: Record<string, { label: string; group: TagGroup }> = {
  // generic code
  code: { label: 'Code', group: 'code' },
  command: { label: 'Command', group: 'code' },
  json: { label: 'JSON', group: 'code' },
  yaml: { label: 'YAML', group: 'code' },
  sql: { label: 'SQL', group: 'code' },
  // languages
  python: { label: 'Python', group: 'code' },
  javascript: { label: 'JavaScript', group: 'code' },
  typescript: { label: 'TypeScript', group: 'code' },
  java: { label: 'Java', group: 'code' },
  c: { label: 'C', group: 'code' },
  cpp: { label: 'C++', group: 'code' },
  csharp: { label: 'C#', group: 'code' },
  html: { label: 'HTML', group: 'code' },
  css: { label: 'CSS', group: 'code' },
  bash: { label: 'Bash', group: 'code' },
  powershell: { label: 'PowerShell', group: 'code' },
  go: { label: 'Go', group: 'code' },
  rust: { label: 'Rust', group: 'code' },
  php: { label: 'PHP', group: 'code' },
  // prompts
  prompt: { label: 'Prompt', group: 'prompt' },
  // images
  image: { label: 'Image', group: 'image' },
  screenshot: { label: 'Screenshot', group: 'image' },
  // links
  link: { label: 'Link', group: 'link' },
  url: { label: 'URL', group: 'link' },
  email: { label: 'Email', group: 'link' },
  // network
  ip: { label: 'IP', group: 'network' },
  cidr: { label: 'CIDR', group: 'network' },
  mac: { label: 'MAC', group: 'network' },
  'subnet-mask': { label: 'Subnet mask', group: 'network' },
  port: { label: 'Port', group: 'network' },
  cisco: { label: 'Cisco IOS', group: 'network' },
  // errors
  error: { label: 'Error', group: 'error' },
  'stack-trace': { label: 'Stack trace', group: 'error' },
  // data
  regex: { label: 'Regex', group: 'data' },
  'hex-color': { label: 'Hex color', group: 'data' },
  uuid: { label: 'UUID', group: 'data' },
  hash: { label: 'Hash', group: 'data' },
  base64: { label: 'Base64', group: 'data' },
  timestamp: { label: 'Timestamp', group: 'data' },
  secret: { label: 'Secret', group: 'data' },
};

const LANG_LABELS: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  bash: 'Bash',
  powershell: 'PowerShell',
  json: 'JSON',
  yaml: 'YAML',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
};

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Human label for a tag; custom/unknown tags are title-cased ("my-tag" -> "My Tag"). */
export function tagLabel(tag: string): string {
  return TAG_META[tag]?.label ?? titleCase(tag);
}

/** Human label for a language id ("csharp" -> "C#"). */
export function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? titleCase(lang);
}

/** Display order of groups in the side-panel filter rail. */
export const GROUP_ORDER: TagGroup[] = ['code', 'prompt', 'image', 'link', 'network', 'error', 'data', 'other'];

/** Group label + an icon hint (lucide-style icon name) for the UI. */
export const GROUP_META: Record<TagGroup, { label: string; icon: string }> = {
  code: { label: 'Code', icon: 'braces' },
  prompt: { label: 'Prompts', icon: 'sparkles' },
  image: { label: 'Images', icon: 'image' },
  link: { label: 'Links', icon: 'link' },
  network: { label: 'Network', icon: 'network' },
  error: { label: 'Errors', icon: 'bug' },
  data: { label: 'Data', icon: 'database' },
  other: { label: 'Other', icon: 'tag' },
};
