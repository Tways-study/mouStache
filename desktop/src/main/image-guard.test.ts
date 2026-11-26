import { describe, expect, it } from 'vitest';
import { imageDimensions, isSafeImage, MAX_PIXELS, MAX_SIDE } from './image-guard';

/** A 33-byte "PNG" that is only a signature + IHDR claiming the given size: no pixel data at all. */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[24] = 8; // bit depth
  b[25] = 6; // RGBA
  return b;
}

function gifHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  b[6] = w & 0xff; b[7] = w >> 8; b[8] = h & 0xff; b[9] = h >> 8;
  return b;
}

function jpegHeader(w: number, h: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0, 0, 0, 0]);
}

function webpVp8x(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0], 0);
  const wm = w - 1, hm = h - 1;
  b[24] = wm & 0xff; b[25] = (wm >> 8) & 0xff; b[26] = (wm >> 16) & 0xff;
  b[27] = hm & 0xff; b[28] = (hm >> 8) & 0xff; b[29] = (hm >> 16) & 0xff;
  return b;
}

describe('image header dimensions', () => {
  it('reads PNG, GIF, JPEG and WebP headers', () => {
    expect(imageDimensions(pngHeader(640, 480))).toEqual({ format: 'png', width: 640, height: 480 });
    expect(imageDimensions(gifHeader(300, 200))).toEqual({ format: 'gif', width: 300, height: 200 });
    expect(imageDimensions(jpegHeader(1024, 768))).toEqual({ format: 'jpeg', width: 1024, height: 768 });
    expect(imageDimensions(webpVp8x(800, 600))).toEqual({ format: 'webp', width: 800, height: 600 });
  });

  it('refuses things that are not a readable image header', () => {
    expect(imageDimensions(new Uint8Array(0))).toBeUndefined();
    expect(imageDimensions(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(imageDimensions(pngHeader(1, 1).slice(0, 20))).toBeUndefined();
    const notIhdr = pngHeader(1, 1);
    notIhdr[12] = 0x58;
    expect(imageDimensions(notIhdr)).toBeUndefined();
  });
});

describe('isSafeImage (decompression-bomb guard)', () => {
  it('accepts ordinary sizes up to the limits', () => {
    expect(isSafeImage(pngHeader(1920, 1080))).toBe(true);
    expect(isSafeImage(pngHeader(8000, 8000))).toBe(true); // 64 MP exactly
    expect(isSafeImage(pngHeader(MAX_SIDE, 1))).toBe(true);
    expect(isSafeImage(jpegHeader(4000, 3000))).toBe(true);
  });

  it('refuses a tiny PNG header that claims a huge image', () => {
    expect(isSafeImage(pngHeader(60_000, 60_000))).toBe(false); // 3.6 GP
    expect(isSafeImage(pngHeader(MAX_SIDE + 1, 10))).toBe(false);
    expect(isSafeImage(pngHeader(10, MAX_SIDE + 1))).toBe(false);
    expect(isSafeImage(pngHeader(16_384, 16_384))).toBe(false); // each side fine, too many pixels
    expect(Math.floor(MAX_PIXELS / 8000)).toBe(8000);
    expect(isSafeImage(pngHeader(0xffffffff, 0xffffffff))).toBe(false);
  });

  it('refuses huge GIF, JPEG and WebP claims too', () => {
    expect(isSafeImage(gifHeader(65_535, 65_535))).toBe(false);
    expect(isSafeImage(jpegHeader(65_535, 65_535))).toBe(false);
    expect(isSafeImage(webpVp8x(16_384 * 4, 100))).toBe(false);
  });

  it('refuses zero-sized, unknown and missing input', () => {
    expect(isSafeImage(pngHeader(0, 10))).toBe(false);
    expect(isSafeImage(pngHeader(10, 0))).toBe(false);
    expect(isSafeImage(undefined)).toBe(false);
    expect(isSafeImage(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it('honours custom limits', () => {
    expect(isSafeImage(pngHeader(500, 500), { pixels: 100_000 })).toBe(false);
    expect(isSafeImage(pngHeader(500, 500), { side: 400 })).toBe(false);
  });
});
