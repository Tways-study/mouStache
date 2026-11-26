import { mustacheHalves } from '@/lib/brand/moustache.mjs';

export type MascotMood = 'rest' | 'happy' | 'droop';

const { right, left, box } = mustacheHalves();
const PAD = 4;

interface MascotProps {
  /** rest = idle twitch (empty panel) · happy = tips curl up (success) · droop = tips sag (nothing found). */
  mood?: MascotMood;
  /** Rendered width in px; the height follows the moustache's proportions. */
  size?: number;
  className?: string;
  /** Provide for standalone use; the mascot is decorative (aria-hidden) when omitted. */
  title?: string;
}

/**
 * The mouStache mascot: just the moustache from the logo (same shape, lib/brand/moustache.mjs), no face.
 * It emotes by moving its two halves around the centre bridge; styles/app.css owns the animation and
 * Settings > Reduce motion freezes it on the final pose.
 */
export function Mascot({ mood = 'rest', size = 96, className, title }: MascotProps) {
  const w = box.w + PAD * 2;
  const h = box.h + PAD * 2;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${box.x - PAD} ${box.y - PAD} ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      className={['stache', className].filter(Boolean).join(' ')}
      data-mood={mood}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      overflow="visible"
    >
      <path className="stache-l" d={left} fill="currentColor" />
      <path className="stache-r" d={right} fill="currentColor" />
    </svg>
  );
}
