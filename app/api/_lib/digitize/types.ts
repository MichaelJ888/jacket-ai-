export type DigitizeInput = {
  image: Buffer;
  widthMm: number;
  heightMm?: number;
  maxColors?: number;
  angle?: number;
  rowSpacingMm?: number;
  fillStitchMm?: number;
  pullCompMm?: number;
  minSpecklePx?: number;
  maxLongestSidePx?: number;
  designName?: string;
};

export type StitchCommand = 'stitch' | 'jump' | 'trim' | 'color-change' | 'end';

export type Stitch = {
  x: number;
  y: number;
  command: StitchCommand;
  color: number;
};

export type ThreadColor = {
  index: number;
  rgb: [number, number, number];
  hex: string;
  name: string;
};

export type QaThreadSummary = {
  colorIndex: number;
  hex: string;
  name: string;
  stitchCount: number;
};

export type DigitizeQa = {
  stitchCount: number;
  colorChanges: number;
  trims: number;
  jumps: number;
  designWidthMm: number;
  designHeightMm: number;
  densityPerCm2: number;
  minStitchLengthMm: number;
  maxStitchLengthMm: number;
  estimatedMinutesAt700Spm: number;
  threadList: QaThreadSummary[];
  warnings: string[];
  needsHumanReview: boolean;
  confidence: number;
};

export type DigitizeFiles = {
  dst: Buffer;
  exp: Buffer;
  pes: Buffer;
  jef: Buffer;
};

export type DigitizeResult = {
  stitches: Stitch[];
  colors: ThreadColor[];
  qa: DigitizeQa;
  files: DigitizeFiles;
  previewPng: Buffer;
  previewSvg: string;
};
