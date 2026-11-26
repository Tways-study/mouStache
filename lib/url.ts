/** Drop query string and hash from a page URL (they often carry tokens). Shared by the extension and the desktop bridge. */
export function stripUrl(url?: string): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return url;
    return u.origin === 'null' ? `${u.protocol}//${u.pathname}` : u.origin + u.pathname;
  } catch {
    return undefined;
  }
}
