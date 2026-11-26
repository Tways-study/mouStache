import type { ReactNode } from 'react';
import type { TagGroup } from '@/lib/types';

/** SF-Symbols-like 1.5px stroke icons (24x24 viewBox). */
function Svg({ size = 16, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const CheckCircleIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.3 2.8 2.8L16.2 9.5" />
  </Svg>
);
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 5 3 3H7l3-3-1-5Z" />
    <path d="M12 12v8" />
  </Svg>
);
const CodeIcon = (p: P) => (
  <Svg {...p}>
    <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />
  </Svg>
);
const SparkleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" />
  </Svg>
);
const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.4" />
    <path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L19 17" />
  </Svg>
);
const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
const NetworkIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z" />
  </Svg>
);
const ErrorIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5 3.5 19h17L12 4.5Z" />
    <path d="M12 10v4M12 16.8v.1" />
  </Svg>
);
const DataIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 5C7 5 6.5 6 6.5 7.5v2c0 1.2-.7 2.2-2 2.5 1.3.3 2 1.3 2 2.5v2C6.5 18 7 19 9 19M15 5c2 0 2.5 1 2.5 2.5v2c0 1.2.7 2.2 2 2.5-1.3.3-2 1.3-2 2.5v2c0 1.5-.5 2.5-2.5 2.5" />
  </Svg>
);
const DocIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5Z" />
    <path d="M14 3.5V8h4M9.5 12.5h5M9.5 15.5h5" />
  </Svg>
);

export function GroupIcon({ group, ...p }: P & { group: TagGroup }) {
  switch (group) {
    case 'code':
      return <CodeIcon {...p} />;
    case 'prompt':
      return <SparkleIcon {...p} />;
    case 'image':
      return <ImageIcon {...p} />;
    case 'link':
      return <LinkIcon {...p} />;
    case 'network':
      return <NetworkIcon {...p} />;
    case 'error':
      return <ErrorIcon {...p} />;
    case 'data':
      return <DataIcon {...p} />;
    default:
      return <DocIcon {...p} />;
  }
}

/** Static class names so Tailwind can see them. */
export const GROUP_STYLE: Record<TagGroup, { text: string; soft: string }> = {
  code: { text: 'text-tag-code', soft: 'bg-tag-code-soft' },
  prompt: { text: 'text-tag-prompt', soft: 'bg-tag-prompt-soft' },
  image: { text: 'text-tag-image', soft: 'bg-tag-image-soft' },
  link: { text: 'text-tag-link', soft: 'bg-tag-link-soft' },
  network: { text: 'text-tag-network', soft: 'bg-tag-network-soft' },
  error: { text: 'text-tag-error', soft: 'bg-tag-error-soft' },
  data: { text: 'text-tag-data', soft: 'bg-tag-data-soft' },
  other: { text: 'text-tag-other', soft: 'bg-tag-other-soft' },
};
