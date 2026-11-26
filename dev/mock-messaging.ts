import type { StashItemLite } from '../lib/messaging';
export type { StashItemLite } from '../lib/messaging';

const now = Date.now();
const mk = (p: Partial<StashItemLite> & { id: string; tags: string[] }): StashItemLite =>
  ({ kind: 'text', createdAt: now - 60_000, pinned: false, secret: false, ...p }) as StashItemLite;

const ITEMS: StashItemLite[] = [
  mk({ id: '1', tags: ['sql', 'code'], text: 'SELECT u.id, u.email FROM users u WHERE u.created_at > now() - interval \'7 days\';', pinned: true, source: { url: 'https://stackoverflow.com/q/1', title: 'q' } }),
  mk({ id: '2', tags: ['ipv4', 'network'], text: '192.168.1.0/24', createdAt: now - 3_600_000, source: { url: 'https://docs.cisco.com/x', title: 'x' } }),
  mk({ id: '3', tags: ['prompt'], text: 'Act as a senior reviewer. Review the following {{language}} code for bugs.', createdAt: now - 7_200_000 }),
  mk({ id: '4', tags: ['link'], kind: 'link', text: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API', createdAt: now - 86_400_000 }),
  mk({ id: '5', tags: ['stack-trace', 'error'], text: 'TypeError: Cannot read properties of undefined (reading \'map\')\n  at App (App.tsx:42)', createdAt: now - 90_000_000 }),
  mk({ id: '6', tags: ['python', 'code'], text: 'def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)', createdAt: now - 200_000_000 }),
  mk({ id: '7', tags: ['api-key'], text: 'sk_live_51H8xxxxxxxxxxxxxxxxxxxx', secret: true, createdAt: now - 300_000_000 }),
];

export async function send(msg: { type: string; query?: string }): Promise<any> {
  if (msg.type === 'search') {
    const q = (msg.query ?? '').toLowerCase();
    return ITEMS.filter((i) => !q || (i.text ?? '').toLowerCase().includes(q) || i.tags.some((t) => t.includes(q)));
  }
  return { ok: true, kind: 'text', text: 'demo' };
}
export const sendToTab = send;
export const isStashMessage = () => false;
