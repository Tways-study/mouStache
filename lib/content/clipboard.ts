/** Clipboard writing for the palette (image + text), with a self-copy flag. */

let writingUntil = 0;
/** True while mouStache itself is writing to the clipboard (copy listener should ignore). */
export function isStashWriting(now: number = Date.now()): boolean {
  return now < writingUntil;
}
function markWriting() {
  writingUntil = Date.now() + 1000;
}

export async function writeText(text: string): Promise<void> {
  markWriting();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback for pages without clipboard permission/focus
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('png encode failed'))), 'image/png'),
  );
}

export async function writeImageFromDataUrl(dataUrl: string): Promise<void> {
  markWriting();
  const blob = await (await fetch(dataUrl)).blob();
  const png = await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
