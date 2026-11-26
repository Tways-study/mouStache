import type { HighlighterCore } from 'shiki/core';

/**
 * Lazy Shiki singleton. Core + JS regex engine only (no WASM — MV3 CSP safe).
 * Each grammar is its own dynamic import so it code-splits into a separate chunk.
 */
const LANGS: Record<string, () => Promise<unknown>> = {
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  sql: () => import('@shikijs/langs/sql'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  powershell: () => import('@shikijs/langs/powershell'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  php: () => import('@shikijs/langs/php'),
};

let highlighterP: Promise<HighlighterCore> | null = null;
const langP = new Map<string, Promise<void>>();
const htmlCache = new Map<string, string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterP ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark-default')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterP;
}

export function isSupportedLang(lang: string): boolean {
  return lang in LANGS;
}

/**
 * Returns Shiki HTML (dual-theme via CSS variables: --shiki-light / --shiki-dark) or null when the
 * language is unsupported or highlighting fails. The result is escaped by Shiki.
 */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const loader = LANGS[lang];
  if (!loader) return null;
  const key = `${lang}\u0000${code}`;
  const cached = htmlCache.get(key);
  if (cached) return cached;
  try {
    const hl = await getHighlighter();
    let p = langP.get(lang);
    if (!p) {
      p = hl.loadLanguage((await loader()) as never);
      langP.set(lang, p);
    }
    await p;
    const html = hl.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark-default' },
      defaultColor: false,
    });
    if (htmlCache.size > 200) htmlCache.clear();
    htmlCache.set(key, html);
    return html;
  } catch {
    return null;
  }
}
