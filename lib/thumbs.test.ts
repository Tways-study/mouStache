import { describe, expect, it } from 'vitest';
import { fitWithin, scaleRect } from './thumbs';

describe('fitWithin', () => {
  it('downscales landscape keeping aspect', () => {
    expect(fitWithin(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
  });
  it('downscales portrait', () => {
    expect(fitWithin(1000, 2000, 500)).toEqual({ width: 250, height: 500 });
  });
  it('never upscales', () => {
    expect(fitWithin(200, 100, 480)).toEqual({ width: 200, height: 100 });
  });
  it('never returns 0', () => {
    expect(fitWithin(10000, 1, 480)).toEqual({ width: 480, height: 1 });
  });
  it('handles degenerate input', () => {
    expect(fitWithin(0, 0, 480)).toEqual({ width: 1, height: 1 });
  });
});

describe('scaleRect', () => {
  it('scales css px by dpr', () => {
    expect(scaleRect({ x: 10, y: 20, w: 100, h: 50, dpr: 2 }, 1000, 1000)).toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
  });
  it('clamps to image bounds', () => {
    expect(scaleRect({ x: 90, y: 90, w: 100, h: 100, dpr: 1 }, 100, 100)).toEqual({ sx: 90, sy: 90, sw: 10, sh: 10 });
  });
  it('clamps negative origin', () => {
    expect(scaleRect({ x: -10, y: -5, w: 50, h: 50, dpr: 1 }, 100, 100)).toEqual({ sx: 0, sy: 0, sw: 40, sh: 45 });
  });
  it('rounds fractional dpr', () => {
    const r = scaleRect({ x: 10.3, y: 10.3, w: 20.4, h: 20.4, dpr: 1.5 }, 500, 500);
    expect(Number.isInteger(r.sx) && Number.isInteger(r.sw)).toBe(true);
    expect(r.sw).toBeGreaterThan(0);
  });
  it('always yields at least 1px inside bounds', () => {
    const r = scaleRect({ x: 500, y: 500, w: 10, h: 10, dpr: 1 }, 100, 100);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sx + r.sw).toBeLessThanOrEqual(100);
  });
  it('treats missing/zero dpr as 1', () => {
    expect(scaleRect({ x: 1, y: 1, w: 10, h: 10, dpr: 0 }, 100, 100)).toEqual({ sx: 1, sy: 1, sw: 10, sh: 10 });
  });
});
