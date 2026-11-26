import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BlipDuration, BlipMode, BlipPosition, CleanupDays, Density, ReduceMotion, Settings, TextSize, ThemeSetting } from '@/lib/types';
import { desktopBridge, isDesktopApp } from '@/lib/panel/desktop';
import { isMac } from '@/lib/platform';
import { acceleratorFromKeyEvent, validateAccelerator } from '@/lib/accelerator';
import { Sheet } from '@/components/shared/Sheet';
import { Icon } from '@/components/shared/Icon';
import { activeTabHost, appVersion, openShortcutsPage } from '@/lib/panel/ext';
import {
  clearHistory, countOldImages, deleteOldImages, exportJson, getStorageInfo, importJson, saveSettings,
  SCREENSHOT_CLEANUP_DAYS,
} from '@/lib/panel/data';
import { downloadBlob } from '@/lib/panel/clipboard';
import { exportFilename, formatBytes } from '@/lib/panel/helpers';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onToast: (text: string, tone?: 'default' | 'error') => void;
}

const LIMITS = [500, 1000, 2000, 5000];

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
];
const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];
const MOTIONS: { value: ReduceMotion; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const BLIP_MODES: { value: BlipMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'tray', label: 'Tray only' },
  { value: 'blip', label: 'Blip' },
];
const BLIP_POSITIONS: { value: BlipPosition; label: string }[] = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-right', label: 'Top right' },
];
const BLIP_DURATIONS: { value: BlipDuration; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'long', label: 'Long' },
];
const CLEANUPS: { value: CleanupDays; label: string }[] = [
  { value: 0, label: 'Never' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

function Group({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <section>
      {title && <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-label-secondary">{title}</h3>}
      <div className="divide-y divide-separator overflow-hidden rounded-xl bg-elevated shadow-card">{children}</div>
      {note && <p className="px-1 pt-1.5 text-[11.5px] leading-4 text-label-tertiary">{note}</p>}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2">
      <div className="min-w-0">
        <div className="text-[13px] leading-5">{label}</div>
        {hint && <div className="text-[11.5px] leading-4 text-label-secondary">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="truncate text-[11.5px] text-label-secondary">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-[10px] bg-hover p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 min-w-0 flex-1 truncate rounded-[8px] px-1.5 text-[12px] font-medium tabular-nums transition-[background,box-shadow] duration-fast ${
            value === o.value ? 'bg-elevated shadow-card' : 'text-label-secondary hover:text-label-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-base ${checked ? 'bg-[#34c759]' : 'bg-active'}`}
    >
      <span
        className={`absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left] duration-base ease-[var(--ease-out)] ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

type HotkeyEntryStatus = { requested: string; active?: string; ok: boolean; error?: string };

/** "Press the shortcut" field: records a key combination, validates it, and shows why one is refused. */
function HotkeyField({
  label, value, defaultValue, status, onCommit,
}: {
  label: string;
  value: string;
  defaultValue: string;
  status?: HotkeyEntryStatus;
  onCommit: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string>();
  // a registration failure reported by the main process applies to the value we last asked for
  const registrationError = status && !status.ok && status.requested === value ? status.error : undefined;
  const shown = error ?? registrationError;
  return (
    <div className="px-3.5 py-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[13px]">{label}</div>
        {value !== defaultValue && (
          <button type="button" className="text-[11.5px] text-accent hover:underline" onClick={() => { setError(undefined); onCommit(defaultValue); }}>
            Reset
          </button>
        )}
      </div>
      <input
        readOnly
        value={recording ? 'Press the new shortcut…' : value}
        aria-label={label}
        aria-invalid={shown ? true : undefined}
        onFocus={() => { setRecording(true); setError(undefined); }}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') return void e.currentTarget.blur();
          if (e.key === 'Backspace' || e.key === 'Delete') {
            onCommit(defaultValue);
            return void e.currentTarget.blur();
          }
          const acc = acceleratorFromKeyEvent(e.nativeEvent, isMac);
          if (!acc) return; // only modifiers so far
          const v = validateAccelerator(acc);
          if (!v.ok) return void setError(v.error);
          onCommit(v.accelerator);
          e.currentTarget.blur();
        }}
        className="h-8 w-full rounded-lg bg-hover px-2.5 font-mono text-[12px] outline-none focus:shadow-[0_0_0_2px_var(--accent)]"
      />
      {shown && <p role="alert" className="mt-1.5 text-[11.5px] leading-4 text-tag-error">{shown}</p>}
    </div>
  );
}

function ConfirmRow({
  text, confirmLabel, onCancel, onConfirm,
}: {
  text: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-2.5 px-3.5 py-3">
      <p className="text-[13px] leading-5">{text}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-8 flex-1 rounded-lg bg-hover text-[12.5px] font-medium hover:bg-active">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="h-8 flex-1 rounded-lg bg-tag-error text-[12.5px] font-semibold text-white hover:brightness-110">
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function SettingsSheet({ open, onClose, settings, onToast }: Props) {
  const [host, setHost] = useState<string>();
  const [hostInput, setHostInput] = useState('');
  const [confirm, setConfirm] = useState<'history' | 'all' | 'shots' | null>(null);
  const [usage, setUsage] = useState<{ count: number; bytes?: number }>();
  const [oldShots, setOldShots] = useState(0);
  const desktop = isDesktopApp();
  const [login, setLogin] = useState(false);
  const [appInput, setAppInput] = useState('');
  const [hotkeys, setHotkeys] = useState<{ palette: HotkeyEntryStatus; screenshot: HotkeyEntryStatus }>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirm(null);
      return;
    }
    void activeTabHost().then(setHost);
    void getStorageInfo().then(setUsage).catch(() => undefined);
    void countOldImages().then(setOldShots).catch(() => undefined);
    void desktopBridge()?.getLoginItem().then(setLogin).catch(() => undefined);
    void desktopBridge()?.getHotkeyStatus().then(setHotkeys).catch(() => undefined);
  }, [open]);

  /** Save a shortcut, then ask the main process how registering it went (it re-registers on every change). */
  const setHotkey = (p: Partial<Settings>) => {
    set(p);
    setTimeout(() => void desktopBridge()?.getHotkeyStatus().then(setHotkeys).catch(() => undefined), 700);
  };

  const set = (p: Partial<Settings>) => void saveSettings(p);
  const paused = settings.pausedHosts;
  const addHost = (h: string) => {
    const clean = h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!clean || paused.includes(clean)) return;
    set({ pausedHosts: [...paused, clean] });
  };

  const doExport = async () => {
    try {
      const json = await exportJson();
      downloadBlob(new Blob([json], { type: 'application/json' }), exportFilename());
      onToast('Exported your mouStache');
    } catch {
      onToast('Export failed', 'error');
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await importJson(await file.text());
      onToast(`Imported ${r.imported} item${r.imported === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already here` : ''}`);
    } catch {
      onToast('That file isn’t a mouStache export', 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const doClear = async (keepPinned: boolean) => {
    await clearHistory(keepPinned);
    setConfirm(null);
    onToast(keepPinned ? 'History cleared · pinned items kept' : 'Everything deleted');
  };

  const doCleanShots = async () => {
    const n = await deleteOldImages();
    setConfirm(null);
    setOldShots(await countOldImages());
    setUsage(await getStorageInfo());
    onToast(n ? `Deleted ${n} old image${n === 1 ? '' : 's'}` : 'Nothing to clean up');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      crumb="~/moustache/settings"
      footer={
        <footer className="shrink-0 border-t border-separator px-4 py-2.5 text-center font-mono text-[11px] text-label-tertiary">
          mouStache v{appVersion()} · stored on this device only
        </footer>
      }
    >
      <div className="space-y-5 p-4">
        <Group title="Comfort" note="Changes apply right away, in the panel and on pages.">
          <Field label="Theme">
            <Segmented label="Theme" value={settings.theme} options={THEMES} onChange={(v) => set({ theme: v })} />
          </Field>
          <Field label="Text size">
            <Segmented label="Text size" value={settings.textSize} options={TEXT_SIZES} onChange={(v) => set({ textSize: v })} />
          </Field>
          <Field label="Density" hint={settings.density === 'compact' ? 'One line per item' : 'Cards with previews'}>
            <Segmented label="Density" value={settings.density} options={DENSITIES} onChange={(v) => set({ density: v })} />
          </Field>
          <Field label="Reduce motion">
            <Segmented label="Reduce motion" value={settings.reduceMotion} options={MOTIONS} onChange={(v) => set({ reduceMotion: v })} />
          </Field>
          {!desktop && (
            <Row label="Quiet mode" hint="No on-page toast, no toolbar badge count">
              <Switch
                label="Quiet mode"
                checked={!settings.showToast && !settings.badgeCount}
                onChange={(v) => set({ showToast: !v, badgeCount: !v })}
              />
            </Row>
          )}
        </Group>

        {desktop && (
          <>
            <Group title="Presence" note="mouStache listens quietly in the background. Skipped copies (secrets, password managers, paused apps) never show anything.">
              <Field label="On-screen blip" hint={settings.blipMode === 'blip' ? 'A tiny “Saved · SQL” pill' : settings.blipMode === 'tray' ? 'Only the tray icon reacts' : 'No feedback at all'}>
                <Segmented label="On-screen blip" value={settings.blipMode} options={BLIP_MODES} onChange={(v) => set({ blipMode: v })} />
              </Field>
              <Field label="Blip position">
                <Segmented label="Blip position" value={settings.blipPosition} options={BLIP_POSITIONS} onChange={(v) => set({ blipPosition: v })} />
              </Field>
              <Field label="Blip duration">
                <Segmented label="Blip duration" value={settings.blipDuration} options={BLIP_DURATIONS} onChange={(v) => set({ blipDuration: v })} />
              </Field>
              {isMac && (
                <Row label="Menu-bar count" hint="Show today’s count next to the icon">
                  <Switch label="Menu-bar count" checked={settings.menuBarCount} onChange={(v) => set({ menuBarCount: v })} />
                </Row>
              )}
              <Row label="Weekly summary" hint="Saved for a later update">
                <Switch label="Weekly summary" checked={settings.weeklySummary} onChange={(v) => set({ weeklySummary: v })} />
              </Row>
              <Row label="Pause capture" hint="Stop listening to the clipboard">
                <Switch label="Pause capture" checked={!settings.autoCapture} onChange={(v) => set({ autoCapture: !v })} />
              </Row>
            </Group>

            <Group title="Desktop" note="Copies made while one of these apps is in front are never saved. App detection is best effort.">
              <Row label="Launch at login" hint="Starts hidden in the tray">
                <Switch
                  label="Launch at login"
                  checked={login}
                  onChange={(v) => {
                    setLogin(v);
                    void desktopBridge()?.setLoginItem(v);
                  }}
                />
              </Row>
              <HotkeyField
                label="Quick palette shortcut"
                value={settings.hotkeyPalette}
                defaultValue="Alt+Shift+V"
                status={hotkeys?.palette}
                onCommit={(a) => setHotkey({ hotkeyPalette: a })}
              />
              <HotkeyField
                label="Region screenshot shortcut"
                value={settings.hotkeyScreenshot}
                defaultValue="Alt+Shift+S"
                status={hotkeys?.screenshot}
                onCommit={(a) => setHotkey({ hotkeyScreenshot: a })}
              />
              <div className="space-y-2.5 px-3.5 py-3">
                <div className="text-[13px]">Paused apps</div>
                <div className="flex flex-wrap gap-1.5">
                  {settings.pausedApps.map((a) => (
                    <span key={a} className="inline-flex h-6 items-center gap-1 rounded-full bg-hover pl-2.5 pr-1 text-[11.5px]">
                      {a}
                      <button
                        type="button"
                        aria-label={`Resume capture for ${a}`}
                        className="icon-btn hit !size-[18px] !rounded-full"
                        onClick={() => set({ pausedApps: settings.pausedApps.filter((x) => x !== a) })}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const a = appInput.trim();
                    if (a && !settings.pausedApps.some((x) => x.toLowerCase() === a.toLowerCase())) set({ pausedApps: [...settings.pausedApps, a] });
                    setAppInput('');
                  }}
                >
                  <input
                    value={appInput}
                    onChange={(e) => setAppInput(e.target.value)}
                    placeholder="App name"
                    aria-label="App to pause"
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1 rounded-lg bg-hover px-2.5 text-[12px] outline-none placeholder:text-label-tertiary focus:shadow-[0_0_0_2px_var(--accent)]"
                  />
                  <button type="submit" className="h-8 rounded-lg bg-hover px-3 text-[12px] font-medium hover:bg-active">
                    Add
                  </button>
                </form>
              </div>
            </Group>
          </>
        )}

        <Group title="Capture">
          {!desktop && (
            <>
              <Row label="Auto-capture copies" hint="Save text you copy on any page">
                <Switch label="Auto-capture copies" checked={settings.autoCapture} onChange={(v) => set({ autoCapture: v })} />
              </Row>
              <Row label="Show “Saved” toast" hint="A small pill on the page after a capture">
                <Switch label="Show Saved toast" checked={settings.showToast} onChange={(v) => set({ showToast: v })} />
              </Row>
            </>
          )}
          <Row label="Skip secrets on auto-capture" hint="Keys, tokens and passwords are never saved">
            <Switch label="Skip secrets on auto-capture" checked={settings.skipSecrets} onChange={(v) => set({ skipSecrets: v })} />
          </Row>
        </Group>

        <Group title="Storage">
          <Field label="Keep up to">
            <Segmented
              label="Maximum items"
              value={settings.maxItems}
              options={LIMITS.map((n) => ({ value: n, label: n.toLocaleString() }))}
              onChange={(v) => set({ maxItems: v })}
            />
            <p className="mt-1.5 text-[11.5px] text-label-secondary">Oldest unpinned items are removed first.</p>
          </Field>
          <Field label="Delete unpinned items older than">
            <Segmented label="Auto-cleanup" value={settings.autoCleanupDays} options={CLEANUPS} onChange={(v) => set({ autoCleanupDays: v })} />
            <p className="mt-1.5 text-[11.5px] text-label-secondary">
              {settings.autoCleanupDays
                ? 'Runs daily and when the browser starts. Pinned items are never removed.'
                : 'Nothing is removed by age.'}
            </p>
          </Field>
          {confirm === 'shots' ? (
            <ConfirmRow
              text={`Delete ${oldShots} unpinned image${oldShots === 1 ? '' : 's'} older than ${SCREENSHOT_CLEANUP_DAYS} days? This can’t be undone.`}
              confirmLabel={`Delete ${oldShots}`}
              onCancel={() => setConfirm(null)}
              onConfirm={() => void doCleanShots()}
            />
          ) : (
            <button
              type="button"
              disabled={oldShots === 0}
              onClick={() => setConfirm('shots')}
              className="flex h-11 w-full items-center justify-between px-3.5 text-left text-[13px] hover:bg-hover disabled:opacity-60 disabled:hover:bg-transparent"
            >
              Clean up screenshots
              <span className="text-[12px] text-label-secondary">
                {oldShots === 0 ? `None older than ${SCREENSHOT_CLEANUP_DAYS} days` : `${oldShots} older than ${SCREENSHOT_CLEANUP_DAYS} days`}
              </span>
            </button>
          )}
          {usage && (
            <p className="px-3.5 py-2 font-mono text-[11px] text-label-tertiary">
              mouStache is using {usage.count.toLocaleString()} item{usage.count === 1 ? '' : 's'}
              {usage.bytes ? ` · ~${formatBytes(usage.bytes)}` : ''}
            </p>
          )}
        </Group>

        {!desktop && <Group title="Paused sites" note="mouStache won’t capture copies on these sites.">
          <div className="space-y-2.5 px-3.5 py-3">
            {paused.length === 0 && <p className="text-[12.5px] text-label-secondary">No paused sites.</p>}
            <div className="flex flex-wrap gap-1.5">
              {paused.map((h) => (
                <span key={h} className="inline-flex h-6 items-center gap-1 rounded-full bg-hover pl-2.5 pr-1 font-mono text-[11.5px]">
                  {h}
                  <button
                    type="button"
                    aria-label={`Resume capture on ${h}`}
                    className="icon-btn hit !size-[18px] !rounded-full"
                    onClick={() => set({ pausedHosts: paused.filter((x) => x !== h) })}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addHost(hostInput);
                setHostInput('');
              }}
            >
              <input
                value={hostInput}
                onChange={(e) => setHostInput(e.target.value)}
                placeholder="example.com"
                aria-label="Site to pause"
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-lg bg-hover px-2.5 font-mono text-[12px] outline-none placeholder:text-label-tertiary focus:shadow-[0_0_0_2px_var(--accent)]"
              />
              <button type="submit" className="h-8 rounded-lg bg-hover px-3 text-[12px] font-medium hover:bg-active">
                Add
              </button>
            </form>
            {host && !paused.includes(host) && (
              <button
                type="button"
                onClick={() => addHost(host)}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-soft text-[12.5px] font-medium text-accent hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
              >
                <Icon name="plus" size={13} />
                Pause on <span className="font-mono">{host}</span>
              </button>
            )}
          </div>
        </Group>}

        <Group title="Your data">
          <button type="button" onClick={doExport} className="flex h-11 w-full items-center justify-between px-3.5 text-left text-[13px] hover:bg-hover">
            Export JSON
            <Icon name="download" size={15} className="text-label-secondary" />
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex h-11 w-full items-center justify-between px-3.5 text-left text-[13px] hover:bg-hover">
            Import JSON
            <Icon name="upload" size={15} className="text-label-secondary" />
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void doImport(e.target.files?.[0])} />
        </Group>

        {!desktop && <Group>
          <button type="button" onClick={openShortcutsPage} className="flex h-11 w-full items-center justify-between px-3.5 text-left text-[13px] hover:bg-hover">
            Keyboard shortcuts
            <Icon name="external" size={14} className="text-label-secondary" />
          </button>
        </Group>}

        <Group title="Danger zone">
          {confirm === 'history' || confirm === 'all' ? (
            <ConfirmRow
              text={
                confirm === 'history'
                  ? 'Delete everything except pinned items? This can’t be undone.'
                  : 'Delete every item, including pinned? This can’t be undone.'
              }
              confirmLabel={confirm === 'history' ? 'Clear history' : 'Delete everything'}
              onCancel={() => setConfirm(null)}
              onConfirm={() => void doClear(confirm === 'history')}
            />
          ) : (
            <>
              <button type="button" onClick={() => setConfirm('history')} className="flex h-11 w-full items-center px-3.5 text-left text-[13px] text-tag-error hover:bg-hover">
                Clear history (keep pinned)
              </button>
              <button type="button" onClick={() => setConfirm('all')} className="flex h-11 w-full items-center px-3.5 text-left text-[13px] text-tag-error hover:bg-hover">
                Delete everything
              </button>
            </>
          )}
        </Group>
      </div>
    </Sheet>
  );
}
