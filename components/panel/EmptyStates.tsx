import type { ReactNode } from 'react';
import { Icon } from '@/components/shared/Icon';
import { Mascot } from '@/components/shared/Mascot';
import { Combo } from '@/components/shared/Keycap';
import { SCREENSHOT_TO_CLIPBOARD } from '@/lib/platform';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-3.5 py-3">
      <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10.5px] font-semibold text-accent">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-5">{title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-label-secondary">{children}</div>
      </div>
    </li>
  );
}

export function Onboarding({ onPaste }: { onPaste: () => void }) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col px-5 pb-10 pt-10">
      <div className="mb-6">
        <Mascot mood="rest" size={72} className="mb-4 text-accent" />
        <p className="font-mono text-[11px] text-label-tertiary">$ moustache ls</p>
        <h2 className="mt-1.5 text-[24px] font-semibold leading-[30px] tracking-[-0.025em]">
          <span className="font-mono text-[22px] tracking-[-0.04em]">~/moustache</span> is clean-shaven<span className="caret" aria-hidden="true" />
        </h2>
        <p className="mt-2 max-w-[34ch] text-[13.5px] leading-5 text-label-secondary">
          Copy something and it grows here: snippets, commands, prompts and screenshots, tagged and searchable.
        </p>
      </div>

      <ol className="divide-y divide-separator overflow-hidden rounded-xl bg-elevated shadow-card">
        <Step n={1} title="Copy anything — it lands here">
          <span>Select text on any page, then</span> <Combo keys={['Mod', 'C']} />
        </Step>
        <Step n={2} title="Search and paste from anywhere">
          <Combo keys={['Alt', 'Shift', 'V']} /> <span>opens the quick palette on any tab</span>
        </Step>
        <Step n={3} title="Paste screenshots here">
          <Combo keys={SCREENSHOT_TO_CLIPBOARD} /> <span>then</span> <Combo keys={['Mod', 'V']} />
          <span>in this panel</span>
        </Step>
      </ol>

      <button
        type="button"
        onClick={onPaste}
        className="mt-4 flex h-9 items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-[13px] font-medium text-accent-contrast shadow-card transition-[transform,filter] duration-fast hover:brightness-105 active:scale-[0.98]"
      >
        <Icon name="clipboard" size={15} />
        Paste from clipboard
      </button>

      <p className="mt-5 flex items-start gap-2 text-[12px] leading-4 text-label-tertiary">
        <Icon name="tag" size={13} className="mt-px shrink-0" />
        <span>
          Pin mouStache to your toolbar: open the puzzle-piece menu, then click the pin next to mouStache.
        </span>
      </p>
    </div>
  );
}

export function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-16 text-center">
      <Mascot mood="droop" size={64} className="text-label-tertiary" />
      <h2 className="mt-3 text-[15px] font-semibold tracking-[-0.01em]">
        {query ? `No matches for “${query}”` : 'Nothing in this filter'}
      </h2>
      <p className="mt-1 max-w-[30ch] text-[13px] leading-5 text-label-secondary">
        Search looks through text, tags, languages and source sites.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 h-8 rounded-full bg-accent-soft px-4 text-[13px] font-medium text-accent transition-colors duration-fast hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
      >
        {query ? 'Clear search' : 'Show everything'}
      </button>
    </div>
  );
}
