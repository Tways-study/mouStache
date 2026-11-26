import { useEffect, useState } from 'react';
import { highlight } from '@/lib/panel/highlight';

interface Props {
  code: string;
  /** Shiki grammar id; undefined renders plain mono. */
  lang?: string;
  lineNumbers?: boolean;
  wrap?: boolean;
  /** Clip to the first N lines (cards). */
  maxLines?: number;
  className?: string;
}

export function CodeBlock({ code, lang, lineNumbers, wrap, maxLines, className = '' }: Props) {
  const shown = maxLines ? code.split('\n').slice(0, maxLines).join('\n') : code;
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (!lang) return;
    void highlight(shown, lang).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [shown, lang]);

  if (html) {
    return (
      <div
        className={`code-host ${className}`}
        // Shiki escapes all source text; only its own span/pre markup is injected.
        dangerouslySetInnerHTML={{ __html: html.replace('<pre ', `<pre data-lines="${!!lineNumbers}" data-wrap="${!!wrap}" `) }}
      />
    );
  }
  return (
    <pre
      className={`shiki ${className}`}
      data-lines="false"
      data-wrap={!!wrap}
      style={{ color: 'var(--label-primary)' }}
    >
      <code>{shown}</code>
    </pre>
  );
}
