function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

/** SHA-256 of a UTF-8 string, hex encoded. */
export async function hashText(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

/** SHA-256 of a Blob's bytes, hex encoded. */
export async function hashBlob(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await blobToArrayBuffer(blob)));
}
