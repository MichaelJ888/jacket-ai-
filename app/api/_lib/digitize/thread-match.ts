export type Lab = { l: number; a: number; b: number };

export type ThreadPaletteEntry = {
  brand: 'Isacord' | 'Pantone' | string;
  code: string;
  name: string;
  rgb: [number, number, number];
};

export type ThreadMatch = {
  entry: ThreadPaletteEntry;
  deltaE: number;
};

export const DEFAULT_MAX_DELTA_E = 12;

function srgbToLinear(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(rgb: [number, number, number]): Lab {
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number];
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const pivot = (value: number) => (value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

// CIE76 ΔE: Euclidean distance in Lab space.
export function deltaE(a: Lab, b: Lab) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// Returns the nearest palette thread within maxDeltaE, or null when no thread is close enough.
export function matchThreadColor(
  rgb: [number, number, number],
  palette: ThreadPaletteEntry[],
  maxDeltaE: number = DEFAULT_MAX_DELTA_E,
): ThreadMatch | null {
  if (!palette.length) return null;
  const target = rgbToLab(rgb);
  let best: ThreadMatch | null = null;
  for (const entry of palette) {
    const distance = deltaE(target, rgbToLab(entry.rgb));
    if (!best || distance < best.deltaE) best = { entry, deltaE: distance };
  }
  return best && best.deltaE <= maxDeltaE ? best : null;
}
