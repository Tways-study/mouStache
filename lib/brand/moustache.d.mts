export const CTRL: number[][];
export const HALF: number[][];
export function halfPoints(): number[][];
export function mustachePath(): string;
export function mustacheHalves(): {
  right: string;
  left: string;
  box: { x: number; y: number; w: number; h: number };
};
