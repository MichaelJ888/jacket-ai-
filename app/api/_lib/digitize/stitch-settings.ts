export const FABRIC_PRESETS = ['cotton-uniform', 'heavy-jacket-twill', 'polo-knit', 'cap-structured'] as const;
export type FabricPreset = (typeof FABRIC_PRESETS)[number];
export type Precision = 'standard' | 'high';

export type StitchSettingsInput = {
  fabric?: unknown;
  autoTune?: unknown;
  precision?: unknown;
  angle?: unknown;
  rowSpacingMm?: unknown;
  fillStitchMm?: unknown;
  pullCompMm?: unknown;
};

export type ComplexityProfile = {
  regionCount: number;
  tinyRegionCount: number;
  maxSideMm: number;
};

export type ResolvedStitchSettings = {
  fabric: FabricPreset;
  precision: Precision;
  autoTune: boolean;
  angle: number;
  rowSpacingMm: number;
  fillStitchMm: number;
  pullCompMm: number;
  notes: string[];
};

const FABRIC_DEFAULTS: Record<FabricPreset, { rowSpacingMm: number; fillStitchMm: number; pullCompMm: number }> = {
  'cotton-uniform': { rowSpacingMm: 0.4, fillStitchMm: 2.6, pullCompMm: 0.25 },
  'heavy-jacket-twill': { rowSpacingMm: 0.38, fillStitchMm: 2.4, pullCompMm: 0.3 },
  'polo-knit': { rowSpacingMm: 0.45, fillStitchMm: 3.2, pullCompMm: 0.4 },
  'cap-structured': { rowSpacingMm: 0.32, fillStitchMm: 2.0, pullCompMm: 0.2 },
};

const LIMITS = {
  angle: [0, 180],
  rowSpacingMm: [0.25, 1.2],
  fillStitchMm: [1.2, 6],
  pullCompMm: [0, 0.6],
} as const;

const HIGH_PRECISION_FACTOR = 0.85;
const DETAIL_RATIO_THRESHOLD = 0.15;
const SMALL_DESIGN_MM = 50;

function clamp(value: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function resolveStitchSettings(input: StitchSettingsInput, profile: ComplexityProfile): ResolvedStitchSettings {
  const fabric = FABRIC_PRESETS.includes(input.fabric as FabricPreset) ? (input.fabric as FabricPreset) : 'cotton-uniform';
  const precision: Precision = input.precision === 'high' ? 'high' : 'standard';
  const autoTune = input.autoTune !== false && input.autoTune !== 'false';
  const notes: string[] = [];

  let rowSpacingMm = FABRIC_DEFAULTS[fabric].rowSpacingMm;
  let fillStitchMm = FABRIC_DEFAULTS[fabric].fillStitchMm;
  let pullCompMm = FABRIC_DEFAULTS[fabric].pullCompMm;

  if (autoTune) {
    const detailRatio = profile.regionCount ? profile.tinyRegionCount / profile.regionCount : 0;
    if (detailRatio > DETAIL_RATIO_THRESHOLD) {
      rowSpacingMm = Math.min(rowSpacingMm, 0.35);
      fillStitchMm = Math.min(fillStitchMm, 2.0);
      notes.push('Fine detail detected: shorter stitches and tighter rows.');
    }
    if (profile.maxSideMm > 0 && profile.maxSideMm < SMALL_DESIGN_MM) {
      fillStitchMm = Math.min(fillStitchMm, 2.0);
      notes.push('Small design: shorter fill stitches for legibility.');
    }
  }

  if (precision === 'high') {
    rowSpacingMm *= HIGH_PRECISION_FACTOR;
    fillStitchMm *= HIGH_PRECISION_FACTOR;
    notes.push('High precision pass: denser rows and shorter stitches.');
  }

  // Explicit values from the advanced panel override AI and preset values.
  if (input.rowSpacingMm !== undefined && input.rowSpacingMm !== '') rowSpacingMm = finiteOr(input.rowSpacingMm, rowSpacingMm);
  if (input.fillStitchMm !== undefined && input.fillStitchMm !== '') fillStitchMm = finiteOr(input.fillStitchMm, fillStitchMm);
  if (input.pullCompMm !== undefined && input.pullCompMm !== '') pullCompMm = finiteOr(input.pullCompMm, pullCompMm);

  return {
    fabric,
    precision,
    autoTune,
    angle: clamp(finiteOr(input.angle, 45), LIMITS.angle),
    rowSpacingMm: round2(clamp(rowSpacingMm, LIMITS.rowSpacingMm)),
    fillStitchMm: round2(clamp(fillStitchMm, LIMITS.fillStitchMm)),
    pullCompMm: round2(clamp(pullCompMm, LIMITS.pullCompMm)),
    notes,
  };
}
