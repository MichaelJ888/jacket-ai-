// Planning heuristic only; the digitizer's output is the authoritative stitch count.
export const STITCH_DENSITY_PER_SQ_INCH = 1200;

export function estimateStitchCount(
  widthInches: number,
  heightInches: number,
  densityPerSqInch = STITCH_DENSITY_PER_SQ_INCH,
) {
  const width = Number.isFinite(widthInches) && widthInches > 0 ? widthInches : 0;
  const height = Number.isFinite(heightInches) && heightInches > 0 ? heightInches : 0;
  return Math.round(width * height * densityPerSqInch);
}
