import { useId } from 'react';
import { mustachePath } from '@/lib/brand/moustache.mjs';

const MOUSTACHE_D = mustachePath();

interface LogoProps {
  /** Rendered size in px (the mark is square). */
  size?: number;
  className?: string;
  /** Provide for standalone use; the mark is decorative (aria-hidden) when omitted. */
  title?: string;
}

/**
 * The mouStache mark: blue→indigo squircle, two stacked bars behind a white card with a handlebar moustache.
 * Keep in sync with scripts/gen-icons.mjs (which renders the toolbar PNGs and public/logo.svg).
 */
export function Logo({ size = 22, className, title }: LogoProps) {
  const gid = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0A84FF" />
          <stop offset="1" stopColor="#5E5CE6" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="29" fill={`url(#${gid})`} />
      <rect x="33.3" y="21.8" width="61.4" height="10.2" rx="5.1" fill="#fff" fillOpacity=".45" />
      <rect x="25.6" y="33.3" width="76.8" height="10.2" rx="5.1" fill="#fff" fillOpacity=".72" />
      <rect x="17.9" y="44.8" width="92.2" height="60.2" rx="11.5" fill="#fff" />
      <path d={MOUSTACHE_D} fill="#3458F0" />
    </svg>
  );
}
