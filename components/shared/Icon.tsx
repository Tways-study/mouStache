import type { SVGProps } from 'react';

const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-3.6-3.6',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.5l1.4 1.1-1.6 2.8-1.7-.5a7 7 0 0 1-1.6.9l-.3 1.8h-3.2l-.3-1.8a7 7 0 0 1-1.6-.9l-1.7.5L6.5 14.6l1.4-1.1a7 7 0 0 1 0-1.8L6.5 10.6l1.6-2.8 1.7.5a7 7 0 0 1 1.6-.9l.3-1.8h3.2l.3 1.8a7 7 0 0 1 1.6.9l1.7-.5 1.6 2.8-1.4 1.1a7 7 0 0 1 0 1.8Z',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM5 15V5a1 1 0 0 1 1-1h10',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  pin: 'M9 4h6l-1 6 3 3v1.5H7V13l3-3-1-6ZM12 14.5V20',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  trash: 'M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10 11v5M14 11v5',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'm14 6-6 6 6 6',
  braces: 'M9 4C7 4 6.5 5 6.5 6.5v2C6.5 10 5.5 11.5 4 12c1.5.5 2.5 2 2.5 3.5v2C6.5 19 7 20 9 20M15 4c2 0 2.5 1 2.5 2.5v2c0 1.5 1 3 2.5 3.5-1.5.5-2.5 2-2.5 3.5v2c0 1.5-.5 2.5-2.5 2.5',
  sparkles: 'M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6L10 4ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z',
  image: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 12 4.5-5 3.5 3.5 2.5-2.5L20 17M9 9.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  network: 'M12 4v5M12 15v5M4 12h5M15 12h5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  bug: 'M9 8V6.5A3 3 0 0 1 12 4a3 3 0 0 1 3 2.5V8M7 9h10v5a5 5 0 0 1-10 0V9ZM4 12h3M17 12h3M5 18l2.5-1.5M19 18l-2.5-1.5M5 7l2.5 1.5M19 7l-2.5 1.5',
  database: 'M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Zm0 0v12c0 1.1 3.1 2 7 2s7-.9 7-2V6M5 12c0 1.1 3.1 2 7 2s7-.9 7-2',
  tag: 'M4 5.5V11l8.5 8.5a1.4 1.4 0 0 0 2 0L19.5 14.5a1.4 1.4 0 0 0 0-2L11 4H5.5A1.5 1.5 0 0 0 4 5.5ZM8.5 8.5h.01',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  region: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M9 9h6v6H9z',
  clipboard: 'M9 4h6v3H9V4ZM8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2',
  download: 'M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14',
  external: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  keyboard: 'M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm3 3h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8',
  upload: 'M12 16V5M7.5 9 12 4.5 16.5 9M5 20h14',
  globe: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM4 12h16M12 4c2.2 2.2 3.2 5 3.2 8s-1 5.8-3.2 8c-2.2-2.2-3.2-5-3.2-8S9.8 6.2 12 4Z',
  wand: 'M5 19 15 9M14 4v3M18.5 5.5 16.5 7.5M20 10h-3M7 5v2M5 6h4',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  chevron: 'm6 9 6 6 6-6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  hash: 'M9 4 7 20M17 4l-2 20M4 9h16M3 15h16',
};

export type IconName = keyof typeof P | string;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={P[name] ?? P.tag} />
    </svg>
  );
}

export function PinFilled({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.5 3.5h7l-1 6.2 3 3.3v2H6.5v-2l3-3.3-1-6.2ZM11.2 15.5h1.6V21h-1.6z" />
    </svg>
  );
}
