import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { StashItem } from '@/lib/types';
import { GROUP_META, TAG_META, tagLabel } from '@/lib/tags';
import { hostname, isMonoItem, itemGroup, previewLine, relativeTime } from '@/lib/content/labels';
import { shikiLang, splitVariables } from '@/lib/panel/helpers';
import { useObjectUrl } from '@/lib/panel/hooks';
import { Icon, PinFilled } from '@/components/shared/Icon';
import { CodeBlock } from './CodeBlock';
import { GROUP_STYLE } from './groupStyle';

export interface CardHandlers {
  onCopy: (item: StashItem) => void;
  onPin: (item: StashItem) => void;
  onExpand: (item: StashItem) => void;
  onDelete: (item: StashItem) => void;
}

interface Props extends CardHandlers {
  item: StashItem;
  now: number;
  copied: boolean;
  fresh: boolean;
  /** Inline "Show more" state (kept by the list so it survives virtualisation). */
  expanded: boolean;
  onToggleMore: (id: string) => void;
}

/** Absolute capture time for hover titles. */
export function absoluteTime(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Does a text card have more to show than its 3-line clamp? */
export function textNeedsMore(text: string): boolean {
  return text.split('\n').length > 3 || text.length > 170;
}

export function codeNeedsMore(text: string): boolean {
  return text.split('\n').length > CODE_LINES;
}

function handleCardKey(e: KeyboardEvent<HTMLDivElement>, item: StashItem, h: CardHandlers) {
  if (e.target !== e.currentTarget) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      h.onCopy(item);
      break;
    case 'p':
      e.preventDefault();
      h.onPin(item);
      break;
    case 'e':
      e.preventDefault();
      h.onExpand(item);
      break;
    case 'Backspace':
    case 'Delete':
      e.preventDefault();
      h.onDelete(item);
      break;
  }
}

function CardActions({ item, onCopy, onPin, onExpand, onDelete }: { item: StashItem } & CardHandlers) {
  return (
    <div className="card-actions vibrancy glass absolute right-2 top-2 flex items-center gap-0.5 rounded-[10px] border border-separator p-0.5 shadow-float">
      <button type="button" className="icon-btn !size-7" aria-label="Copy" title="Copy (Enter)" onClick={() => onCopy(item)}>
        <Icon name="copy" size={15} />
      </button>
      <button
        type="button"
        className="icon-btn !size-7"
        aria-label={item.pinned ? 'Unpin' : 'Pin'}
        aria-pressed={item.pinned}
        title={item.pinned ? 'Unpin (P)' : 'Pin (P)'}
        onClick={() => onPin(item)}
      >
        <Icon name="pin" size={15} />
      </button>
      <button type="button" className="icon-btn !size-7" aria-label="Expand" title="Open details (E)" onClick={() => onExpand(item)}>
        <Icon name="expand" size={15} />
      </button>
      <button type="button" className="icon-btn !size-7 hover:!text-tag-error" aria-label="Delete" title="Delete (Del)" onClick={() => onDelete(item)}>
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

const CODE_LINES = 5;
const GENERIC = new Set(['code', 'link', 'image']);

export function visibleTags(tags: string[], max = 3): string[] {
  const specific = tags.filter((t) => !GENERIC.has(t));
  const list = specific.length ? specific : tags;
  return list.slice(0, max);
}

function ItemCardImpl({ item, now, copied, fresh, expanded, onToggleMore, onCopy, onPin, onExpand, onDelete }: Props) {
  const group = itemGroup(item);
  const style = GROUP_STYLE[group];
  const [revealed, setRevealed] = useState(false);
  const host = hostname(item.source?.url);
  const tags = visibleTags(item.tags);
  const blurred = item.secret && !revealed;

  const handleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    onCopy(item);
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => handleCardKey(e, item, { onCopy, onPin, onExpand, onDelete });

  const summary =
    item.kind === 'image'
      ? `Image${item.width ? ` ${item.width} by ${item.height}` : ''}`
      : (item.text ?? '').slice(0, 80);

  return (
    <div
      role="listitem"
      tabIndex={0}
      data-card
      data-id={item.id}
      data-copied={copied}
      aria-label={`${summary}. Press Enter to copy.`}
      className={`card group cursor-default px-3 pb-2.5 pt-3 ${fresh ? 'fresh' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKey}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRevealed(false);
      }}
    >
      <div className="min-w-0">
        <Preview item={item} blurred={blurred} onReveal={() => setRevealed(true)} expanded={expanded} onToggleMore={onToggleMore} />

        <div className="t-meta mt-2 flex min-w-0 items-center gap-1.5 text-label-secondary">
          <span className={`tile relative grid size-5 shrink-0 place-items-center rounded-md ${style.tile}`} aria-hidden="true">
            <span className="tile-glyph grid place-items-center">
              <Icon name={GROUP_META[group].icon} size={12} />
            </span>
            <span className="tile-check">
              <Icon name="check" size={12} strokeWidth={2.6} />
            </span>
          </span>
          {tags.map((t) => {
            const g = TAG_META[t]?.group ?? 'other';
            return (
              <span
                key={t}
                className={`shrink-0 t-chip rounded-[5px] px-1.5 py-px font-medium ${GROUP_STYLE[g].chip}`}
              >
                {tagLabel(t)}
              </span>
            );
          })}
          <span className="min-w-0 flex-1 truncate">
            {copied ? (
              <span className="font-medium text-accent">Copied</span>
            ) : (
              <>
                <span className="tabular-nums" title={absoluteTime(item.createdAt)}>{relativeTime(item.createdAt, now)}</span>
                {item.kind === 'image' && item.width && item.height ? (
                  <>
                    <span className="text-label-tertiary"> · </span>
                    <span className="font-mono text-[10.5px]">{item.width}×{item.height}</span>
                  </>
                ) : null}
                {host && <span className="text-label-tertiary"> · </span>}
                {host && <span className="text-label-secondary">{host}</span>}
              </>
            )}
          </span>
          {item.pinned && (
            <span className="shrink-0 text-accent" title="Pinned" aria-label="Pinned">
              <PinFilled size={12} />
            </span>
          )}
        </div>
      </div>

      <CardActions item={item} onCopy={onCopy} onPin={onPin} onExpand={onExpand} onDelete={onDelete} />
    </div>
  );
}

function MoreButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="more-btn mt-1 block"
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {expanded ? 'Show less' : 'Show more'}
    </button>
  );
}

interface PreviewProps {
  item: StashItem;
  blurred: boolean;
  onReveal: () => void;
  expanded: boolean;
  onToggleMore: (id: string) => void;
}

function Preview({ item, blurred, onReveal, expanded, onToggleMore }: PreviewProps) {
  const thumbUrl = useObjectUrl(item.kind === 'image' ? (item.thumbBlob ?? item.imageBlob) : undefined);
  const text = item.text ?? '';
  const group = itemGroup(item);
  const toggle = () => onToggleMore(item.id);

  if (item.kind === 'image') {
    return (
      <div className="relative flex max-h-44 min-h-16 items-center justify-center overflow-hidden rounded-lg bg-surface shadow-[inset_0_0_0_0.5px_var(--separator)]">
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt="Captured image"
            draggable={false}
            className="max-h-44 w-full object-contain"
            style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
          />
        )}
      </div>
    );
  }

  if (item.kind === 'link' || (group === 'link' && /^https?:\/\//.test(text.trim()) && !text.includes('\n'))) {
    const { host: h, path } = linkParts(text);
    return (
      <div className="min-w-0 pr-16">
        <div className="t-body-strong truncate">{h ?? text}</div>
        {path && <div className="t-path clamp-2 break-all font-mono text-label-secondary">{path}</div>}
      </div>
    );
  }

  const wrapSecret = (node: React.ReactNode) =>
    item.secret ? (
      <div className="relative">
        <div className="secret-blur" data-revealed={!blurred} aria-hidden={blurred}>
          {node}
        </div>
        {blurred && (
          <>
            <span className="sr-only">Secret hidden</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReveal();
              }}
              className="absolute inset-0 m-auto flex h-7 w-fit items-center gap-1.5 rounded-full border border-separator bg-elevated px-3 text-[12px] font-medium shadow-float transition-transform duration-fast hover:scale-[1.03] active:scale-95"
            >
              <Icon name="eye" size={14} />
              Reveal
            </button>
          </>
        )}
      </div>
    ) : (
      node
    );

  if (isMonoItem(item) && !item.tags.includes('prompt')) {
    const lang = shikiLang(item);
    const long = codeNeedsMore(text);
    const showMore = long && !item.secret;
    const open = expanded && showMore;
    const block = (
      <div
        className={`code-fade t-code overflow-hidden rounded-lg bg-surface px-2.5 py-2 ${long && !open ? 'code-fade-b' : ''}`}
      >
        <div
          className={open ? 'thin-scroll overflow-auto' : 'overflow-hidden'}
          style={{ maxHeight: `calc(${open ? 18 : CODE_LINES} * 17px * var(--ts, 1))` }}
        >
          <CodeBlock code={blurred ? text.slice(0, 200) : text} lang={item.secret ? undefined : lang} maxLines={open ? 60 : CODE_LINES} />
        </div>
      </div>
    );
    return (
      <>
        {wrapSecret(
          lang || item.secret || text.includes('\n') || text.length > 36 ? (
            block
          ) : (
            <div className="t-code-line truncate pr-16 font-mono">{text}</div>
          ),
        )}
        {showMore && <MoreButton expanded={open} onClick={toggle} />}
      </>
    );
  }

  const parts = group === 'prompt' ? splitVariables(text) : [{ text, variable: false }];
  const more = textNeedsMore(text) && !item.secret;
  const open = expanded && more;
  return (
    <>
      {wrapSecret(
        <p
          className={`t-body whitespace-pre-wrap break-words pr-4 ${open ? 'thin-scroll overflow-y-auto' : 'clamp-3'}`}
          style={open ? { maxHeight: 'calc(340px * var(--ts, 1))' } : undefined}
        >
          {parts.map((p, i) =>
            p.variable ? (
              <span key={i} className="rounded-[4px] bg-tag-prompt-soft px-1 font-mono text-tag-prompt" style={{ fontSize: 'calc(11.5px * var(--ts, 1))' }}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>,
      )}
      {more && <MoreButton expanded={open} onClick={toggle} />}
    </>
  );
}

function linkParts(text: string): { host?: string; path: string } {
  let path = '';
  try {
    const u = new URL(text.trim());
    path = u.pathname.replace(/\/$/, '') + u.search + u.hash;
  } catch {
    /* not a URL */
  }
  return { host: hostname(text.trim()), path };
}

/** One-line preview for compact rows. */
export function compactPreview(item: StashItem): { text: string; mono: boolean } {
  if (item.kind === 'image') {
    return { text: `Image${item.width && item.height ? ` · ${item.width}×${item.height}` : ''}`, mono: false };
  }
  if (item.secret) return { text: '••••••••  Secret', mono: false };
  const text = item.text ?? '';
  if (item.kind === 'link') {
    const { host, path } = linkParts(text);
    return { text: host ? `${host}${path}` : text, mono: false };
  }
  return { text: previewLine(text, 200), mono: isMonoItem(item) && !item.tags.includes('prompt') };
}

function CompactCardImpl({ item, now, copied, fresh, onCopy, onPin, onExpand, onDelete }: Props) {
  const group = itemGroup(item);
  const style = GROUP_STYLE[group];
  const host = hostname(item.source?.url);
  const first = visibleTags(item.tags, 1)[0];
  const { text, mono } = compactPreview(item);
  const meta = host ?? (first ? tagLabel(first) : '');

  return (
    <div
      role="listitem"
      tabIndex={0}
      data-card
      data-id={item.id}
      data-copied={copied}
      aria-label={`${text}. Press Enter to copy.`}
      className={`card compact group flex cursor-default items-center gap-2 px-2.5 py-[5px] ${fresh ? 'fresh' : ''}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, input')) onCopy(item);
      }}
      onKeyDown={(e) => handleCardKey(e, item, { onCopy, onPin, onExpand, onDelete })}
    >
      <span className={`tile relative grid size-5 shrink-0 place-items-center rounded-md ${style.tile}`} aria-hidden="true">
        <span className="tile-glyph grid place-items-center">
          <Icon name={GROUP_META[group].icon} size={12} />
        </span>
        <span className="tile-check">
          <Icon name="check" size={12} strokeWidth={2.6} />
        </span>
      </span>
      <span className={`min-w-0 flex-1 truncate ${mono ? 't-code-line font-mono' : 't-body'}`}>{text}</span>
      {copied ? (
        <span className="t-meta shrink-0 font-medium text-accent">Copied</span>
      ) : (
        <>
          {meta && <span className="t-meta max-w-[34%] shrink-0 truncate text-label-secondary">{meta}</span>}
          <span className="t-meta w-7 shrink-0 text-right tabular-nums text-label-secondary" title={absoluteTime(item.createdAt)}>
            {relativeTime(item.createdAt, now)}
          </span>
        </>
      )}
      {item.pinned && (
        <span className="shrink-0 text-accent" title="Pinned" aria-label="Pinned">
          <PinFilled size={12} />
        </span>
      )}
      <CardActions item={item} onCopy={onCopy} onPin={onPin} onExpand={onExpand} onDelete={onDelete} />
    </div>
  );
}

export const ItemCard = memo(ItemCardImpl);
export const CompactCard = memo(CompactCardImpl);
