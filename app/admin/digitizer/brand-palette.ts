export const MJIC_BRAND_PALETTE = [
  { name: "Corporate Navy", hex: "#0D213F" },
  { name: "Executive Gold", hex: "#D4A843" },
] as const;

export function closestMjicBrandColor(hex: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [red, green, blue] = match.slice(1).map((value) => Number.parseInt(value, 16));
  let closest: { name: string; hex: string; distance: number } = { ...MJIC_BRAND_PALETTE[0], distance: Infinity };
  for (const color of MJIC_BRAND_PALETTE) {
    const components = color.hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? [];
    const distance = (red - components[0]) ** 2 + (green - components[1]) ** 2 + (blue - components[2]) ** 2;
    if (distance < closest.distance) closest = { ...color, distance };
  }
  return closest;
}
