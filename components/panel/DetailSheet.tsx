import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StashItem } from '@/lib/types';
import { Sheet } from '@/components/shared/Sheet';
import { Icon } from '@/components/shared/Icon';
import { GROUP_META, TAG_META, langLabel, tagLabel } from '@/lib/tags';
import { hostname, isMonoItem, itemGroup } from '@/lib/content/labels';
import { fenceLang, formatBytes, formatJson, markdownFence, normalizeTag, shikiLang } from '@/lib/panel/helpers';
import { copyImageBlob, copyText, downloadBlob, toPngBlob } from '@/lib/panel/clipboard';
import { openUrl } from '@/lib/panel/ext';
import { useObjectUrl } from '@/lib/panel/hooks';
import { CodeBlock } from './CodeBlock';
import { GROUP_STYLE } from './groupStyle';

interface Props {
  open: boolean;
  item: StashItem | null;
  onClose: () => void;
  onPin: (item: StashItem) => void;
  onDelete: (item: StashItem) => void;
  onTags: (item: StashItem, tags: string[]) => void;
  onToast: (text: string, tone?: 'default' | 'error') => void;
}

function Btn({
  icon, children, onClick, primary,
}: {
  icon: string;
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-[transform,background,filter] duration-fast active:scale-[0.97] ${
        primary ? 'bg-accent text-accent-contrast hover:brightness-105' : 'bg-hover hover:bg-active'
      }`}
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}

export function DetailSheet({ open, item, onClose, onPin, onDelete, onTags, onToast }: Props) {
  // Keep the last item mounted during the exit animation.
  const last = useRef<StashItem | null>(null);
  if (item) last.current = item;
  const it = item ?? last.current;

  return (
    <Sheet
      open={open && !!item}
      onClose={onClose}
      title={it ? (it.kind === 'image' ? 'Image' : GROUP_META[itemGroup(it)].label.replace(/s$/, '')) : ''}
      crumb={it ? `~/moustache/${it.id.slice(0, 8)}` : undefined}
      actions={
        it && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="icon-btn"
              aria-label={it.pinned ? 'Unpin' : 'Pin'}
              aria-pressed={it.pinned}
              onClick={() => onPin(it)}
            >
              <Icon name="pin" size={16} />
            </button>
            <button
              type="button"
              className="icon-btn hover:!text-tag-error"
              aria-label="Delete"
              onClick={() => {
                onDelete(it);
                onClose();
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        )
      }
    >
      {it && <DetailBody key={it.id} item={it} onTags={onTags} onToast={onToast} />}
    </Sheet>
  );
}

function DetailBody({
  item, onTags, onToast,
}: {
  item: StashItem;
  onTags: Props['onTags'];
  onToast: Props['onToast'];
}) {
  const group = itemGroup(item);
  const [text, setText] = useState(item.text ?? '');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setText(item.text ?? ''), [item.text]);
  const lang = shikiLang(item);
  const isJson = item.tags.includes('json') || item.lang === 'json';
  const mono = isMonoItem(item) && !item.tags.includes('prompt');
  const imgUrl = useObjectUrl(item.kind === 'image' ? (item.imageBlob ?? item.thumbBlob) : undefined);
  const host = hostname(item.source?.url);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      onToast(ok);
    } catch {
      onToast('Couldn’t reach the clipboard', 'error');
    }
  };

  const hidden = item.secret && !revealed;

  return (
    <div className="space-y-4 p-4">
      {item.kind === 'image' ? (
        <>
          <div className="overflow-hidden rounded-xl bg-elevated p-1.5 shadow-card">
            {imgUrl && (
              <img src={imgUrl} alt="Captured image" className="mx-auto max-h-[46vh] w-auto max-w-full rounded-lg object-contain" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn primary icon="copy" onClick={() => void run(() => copyImageBlob((item.imageBlob ?? item.thumbBlob)!), 'Image copied')}>
              Copy image
            </Btn>
            <Btn
              icon="download"
              onClick={() =>
                void run(async () => {
                  const png = await toPngBlob((item.imageBlob ?? item.thumbBlob)!);
                  downloadBlob(png, `moustache-${new Date(item.createdAt).toISOString().slice(0, 10)}.png`);
                }, 'Download started')
              }
            >
              Download PNG
            </Btn>
            <Btn icon="external" onClick={() => imgUrl && window.open(imgUrl, '_blank', 'noopener')}>
              Open in new tab
            </Btn>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Btn primary icon="copy" onClick={() => void run(() => copyText(text), 'Copied')}>
              {mono ? 'Copy raw' : 'Copy'}
            </Btn>
            {mono && (
              <Btn icon="braces" onClick={() => void run(() => copyText(markdownFence(text, fenceLang(item))), 'Copied as Markdown block')}>
                Copy as Markdown
              </Btn>
            )}
            {isJson && (
              <Btn
                icon="wand"
                onClick={() => {
                  const f = formatJson(text);
                  if (!f) return onToast('Not valid JSON', 'error');
                  setText(f);
                  void run(() => copyText(f), 'Formatted JSON copied');
                }}
              >
                Format JSON
              </Btn>
            )}
            {item.kind === 'link' || /^https?:\/\/\S+$/.test(text.trim()) ? (
              <Btn icon="external" onClick={() => openUrl(text.trim())}>
                Open link
              </Btn>
            ) : null}
          </div>

          <div className="relative overflow-hidden rounded-xl bg-elevated shadow-card">
            {mono && (
              <div className="flex items-center justify-between border-b border-separator px-3 py-1.5 font-mono text-[11px] text-label-secondary">
                <span>{lang ? langLabel(item.lang ?? item.tags.find((t) => TAG_META[t]?.group === 'code') ?? lang) : 'plain text'}</span>
                <span className="tabular-nums">{text.split('\n').length} lines</span>
              </div>
            )}
            <div className={`secret-blur thin-scroll overflow-x-auto p-3 text-[12px] leading-[19px] ${mono ? '' : 'text-[13.5px] leading-[21px]'}`} data-revealed={!hidden}>
              {mono ? (
                <CodeBlock code={text} lang={item.secret ? undefined : lang} lineNumbers wrap={!lang} />
              ) : (
                <p className="whitespace-pre-wrap break-words">{text}</p>
              )}
            </div>
            {hidden && (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="absolute inset-0 m-auto flex h-8 w-fit items-center gap-1.5 rounded-full border border-separator bg-elevated px-3.5 text-[12.5px] font-medium shadow-float"
              >
                <Icon name="eye" size={14} />
                Reveal secret
              </button>
            )}
          </div>
        </>
      )}

      <TagEditor tags={item.tags} onChange={(tags) => onTags(item, tags)} />

      <dl className="divide-y divide-separator overflow-hidden rounded-xl bg-elevated text-[12.5px] shadow-card">
        {item.source?.url && (
          <InfoRow label="Source">
            <button type="button" className="max-w-full truncate text-accent hover:underline" onClick={() => openUrl(item.source!.url!)} title={item.source.url}>
              {item.source.title || host}
            </button>
          </InfoRow>
        )}
        <InfoRow label="Captured">{new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</InfoRow>
        <InfoRow label="Via">{({ copy: 'Copied on a page', 'context-menu': 'Context menu', screenshot: 'Screenshot', paste: 'Pasted', import: 'Imported' } as const)[item.via]}</InfoRow>
        {item.kind === 'image' ? (
          <InfoRow label="Size">
            {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
            {formatBytes((item.imageBlob ?? item.thumbBlob)?.size ?? 0)}
          </InfoRow>
        ) : (
          <InfoRow label="Length">{text.length.toLocaleString()} characters</InfoRow>
        )}
        <InfoRow label="Type">
          <span className={GROUP_STYLE[group].text}>{GROUP_META[group].label}</span>
        </InfoRow>
      </dl>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3.5 py-2">
      <dt className="shrink-0 text-label-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [value, setValue] = useState('');
  const [focus, setFocus] = useState(false);
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    return Object.entries(TAG_META)
      .filter(([k, m]) => !tags.includes(k) && k !== 'secret' && (!q || k.includes(q) || m.label.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [value, tags]);

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setValue('');
  };

  return (
    <section>
      <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-label-secondary">Tags</h3>
      <div className="relative rounded-xl bg-elevated p-2.5 shadow-card">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => {
            const g = TAG_META[t]?.group ?? 'other';
            return (
              <span key={t} className={`inline-flex h-6 items-center gap-0.5 rounded-md pl-2 pr-0.5 text-[11.5px] font-medium ${GROUP_STYLE[g].chip}`}>
                {tagLabel(t)}
                <button
                  type="button"
                  aria-label={`Remove tag ${tagLabel(t)}`}
                  className="grid size-5 place-items-center rounded opacity-60 hover:opacity-100"
                  onClick={() => onChange(tags.filter((x) => x !== t))}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            );
          })}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(value);
              } else if (e.key === 'Backspace' && !value && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
            placeholder={tags.length ? 'Add tag…' : 'Add a tag…'}
            aria-label="Add tag"
            className="h-6 min-w-[88px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-label-tertiary"
          />
        </div>
        {focus && suggestions.length > 0 && (
          <ul className="pop vibrancy glass absolute inset-x-2 top-full z-10 mt-1 overflow-hidden rounded-lg border border-separator p-1 shadow-float">
            {suggestions.map(([k, m]) => (
              <li key={k}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(k)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
                >
                  <span>{m.label}</span>
                  <span className={`text-[11px] ${GROUP_STYLE[m.group].text}`}>{GROUP_META[m.group].label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
