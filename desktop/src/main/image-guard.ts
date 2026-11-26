/**
 * Refuse decompression bombs BEFORE handing bytes to the image decoder (nativeImage.createFromBuffer): read the
 * dimensions straight from the file header and reject anything absurd. A tiny PNG can claim 60000 x 60000 pixels
 * and make the decoder allocate gigabytes. Pure and dependency free.
 */
export const MAX_SIDE = 16_384;
export const MAX_PIXELS = 64_000_000;

export interface Dimensions {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'gif' | 'webp';
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Dimensions from the header, or undefined when the bytes are not a PNG / JPEG / GIF / WebP we can read. */
export function imageDimensions(b: Uint8Array): Dimensions | undefined {
  const u8 = (i: number) => b[i] ?? 0;
  const be32 = (i: number) => ((u8(i) << 24) | (u8(i + 1) << 16) | (u8(i + 2) << 8) | u8(i + 3)) >>> 0;
  const be16 = (i: number) => (u8(i) << 8) | u8(i + 1);
  const le16 = (i: number) => u8(i) | (u8(i + 1) << 8);
  const le24 = (i: number) => u8(i) | (u8(i + 1) << 8) | (u8(i + 2) << 16);

  // PNG: signature, then the IHDR chunk (length 13, "IHDR", width, height)
  if (b.length >= 24 && PNG_SIG.every((v, i) => u8(i) === v)) {
    if (be32(8) !== 13 || String.fromCharCode(u8(12), u8(13), u8(14), u8(15)) !== 'IHDR') return undefined;
    return { format: 'png', width: be32(16), height: be32(20) };
  }
  // GIF: "GIF87a" / "GIF89a", then little-endian width and height
  if (b.length >= 10 && u8(0) === 0x47 && u8(1) === 0x49 && u8(2) === 0x46 && u8(3) === 0x38 && (u8(4) === 0x37 || u8(4) === 0x39) && u8(5) === 0x61) {
    return { format: 'gif', width: le16(6), height: le16(8) };
  }
  // JPEG: walk the markers to the first start-of-frame
  if (b.length >= 4 && u8(0) === 0xff && u8(1) === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (u8(i) !== 0xff) return undefined;
      const marker = u8(i + 1);
      if (marker === 0xff) {
        i++;
        continue;
      }
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        return { format: 'jpeg', height: be16(i + 5), width: be16(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + be16(i + 2);
    }
    return undefined;
  }
  // WebP: RIFF....WEBP then VP8X (canvas size), VP8L (lossless) or VP8 (lossy)
  if (b.length >= 30 && String.fromCharCode(u8(0), u8(1), u8(2), u8(3)) === 'RIFF' && String.fromCharCode(u8(8), u8(9), u8(10), u8(11)) === 'WEBP') {
    const kind = String.fromCharCode(u8(12), u8(13), u8(14), u8(15));
    if (kind === 'VP8X') return { format: 'webp', width: le24(24) + 1, height: le24(27) + 1 };
    if (kind === 'VP8L' && u8(20) === 0x2f) {
      const bits = u8(21) | (u8(22) << 8) | (u8(23) << 16) | (u8(24) << 24);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ' && u8(23) === 0x9d && u8(24) === 0x01 && u8(25) === 0x2a) {
      return { format: 'webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    }
    return undefined;
  }
  return undefined;
}

/** True only when the header is readable and the claimed size is sane. Unknown formats are refused. */
export function isSafeImage(bytes: Uint8Array | undefined, limits: { side?: number; pixels?: number } = {}): boolean {
  if (!bytes) return false;
  const d = imageDimensions(bytes);
  if (!d || d.width < 1 || d.height < 1) return false;
  const side = limits.side ?? MAX_SIDE;
  return d.width <= side && d.height <= side && d.width * d.height <= (limits.pixels ?? MAX_PIXELS);
}
