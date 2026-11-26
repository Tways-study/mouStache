/** Trailing debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
  };
  return d;
}

/** Returns true the first time a value is seen within `windowMs`; false for repeats. */
export function createDedupe(windowMs: number, now: () => number = Date.now) {
  const seen = new Map<string, number>();
  return (value: string): boolean => {
    const t = now();
    for (const [k, at] of seen) if (t - at > windowMs) seen.delete(k);
    const prev = seen.get(value);
    if (prev !== undefined && t - prev <= windowMs) return false;
    seen.set(value, t);
    return true;
  };
}

/** Sliding-window rate limit: allows at most `max` calls per `windowMs`; extras return false. */
export function createRateLimit(max: number, windowMs: number, now: () => number = Date.now) {
  let stamps: number[] = [];
  return (): boolean => {
    const t = now();
    stamps = stamps.filter((s) => t - s < windowMs);
    if (stamps.length >= max) return false;
    stamps.push(t);
    return true;
  };
}
