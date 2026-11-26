/**
 * Image helpers usable in the service worker, content scripts and extension pages
 * (createImageBitmap + OffscreenCanvas; no DOM).
 */
export interface ThumbResult { thumbBlob: Blob; width: number; height: number }

export interface CropRect { x: number; y: number; w: number; h: number; dpr: number }

/** Blobs at or below this size that already fit are returned untouched. */
const REENCODE_THRESHOLD = 150 * 1024;

/** Scale (w,h) down so the longest side is <= maxSide. Never upscales, never returns 0. */
export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number } {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const longest = Math.max(W, H);
  if (longest <= maxSide) return { width: W, height: H };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(W * k)), height: Math.max(1, Math.round(H * k)) };
}

/**
 * Convert a CSS-pixel rect (times dpr) into integer source-pixel coordinates clamped to the image.
 * Always returns at least a 1x1 region inside the bounds.
 */
export function scaleRect(
  rect: CropRect,
  imgW: number,
  imgH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const dpr = rect.dpr > 0 ? rect.dpr : 1;
  const x0 = Math.round(rect.x * dpr);
  const y0 = Math.round(rect.y * dpr);
  const x1 = Math.round((rect.x + rect.w) * dpr);
  const y1 = Math.round((rect.y + rect.h) * dpr);
  const W = Math.max(1, Math.floor(imgW));
  const H = Math.max(1, Math.floor(imgH));
  const sx = Math.min(Math.max(0, Math.min(x0, x1)), W - 1);
  const sy = Math.min(Math.max(0, Math.min(y0, y1)), H - 1);
  const ex = Math.min(W, Math.max(Math.max(x0, x1), sx + 1));
  const ey = Math.min(H, Math.max(Math.max(y0, y1), sy + 1));
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/** Decode only to read the intrinsic pixel size. */
export async function blobToImageDims(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  try {
    return { width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

async function encode(canvas: OffscreenCanvas): Promise<Blob> {
  try {
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    if (webp.type === 'image/webp') return webp;
  } catch {
    /* fall through to png */
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Downscale `blob` so its longest side is <= maxSide (default 480), WebP/PNG output. Returns original dimensions. */
export async function makeThumb(blob: Blob, maxSide = 480): Promise<ThumbResult> {
  const bmp = await createImageBitmap(blob);
  try {
    const width = bmp.width;
    const height = bmp.height;
    const fit = fitWithin(width, height, maxSide);
    const needsResize = fit.width !== width || fit.height !== height;
    if (!needsResize && blob.size <= REENCODE_THRESHOLD) {
      return { thumbBlob: blob, width, height };
    }
    const canvas = new OffscreenCanvas(fit.width, fit.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { thumbBlob: blob, width, height };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, fit.width, fit.height);
    const out = await encode(canvas);
    // Re-encoding a small image can inflate it; keep the original in that case.
    if (!needsResize && out.size >= blob.size) return { thumbBlob: blob, width, height };
    return { thumbBlob: out, width, height };
  } finally {
    bmp.close();
  }
}

/** Crop a region (CSS px * dpr) out of an image blob. Returns a PNG blob. */
export async function cropImage(blob: Blob, rect: CropRect): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const { sx, sy, sw, sh } = scaleRect(rect, bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bmp.close();
  }
}
