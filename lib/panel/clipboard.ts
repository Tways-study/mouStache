import { blobToDataUrl } from '@/lib/db';
import type { StashItem } from '@/lib/types';

export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for contexts where the async API is blocked.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Clipboard unavailable');
  }
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  const png = await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** Copy whatever the item is (text/link as text, image as PNG). */
export async function copyItem(item: StashItem): Promise<void> {
  if (item.kind === 'image') {
    const blob = item.imageBlob ?? item.thumbBlob;
    if (!blob) throw new Error('No image data');
    return copyImageBlob(blob);
  }
  return copyText(item.text ?? '');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return blobToDataUrl(file);
}
