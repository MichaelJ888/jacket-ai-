import sharp from 'sharp';

import { encodeAllFormats } from './encoders.ts';
import type { DigitizeInput, DigitizeQa, DigitizeResult, QaThreadSummary, Stitch, ThreadColor } from './types.ts';

type Lab = { l: number; a: number; b: number };
type Region = {
  id: string;
  colorIndex: number;
  color: ThreadColor;
  mask: Uint8Array;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  areaPx: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  centroid: { x: number; y: number };
};

type PlannedRegion = {
  region: Region;
  start: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
  category: 'fill' | 'satin' | 'running';
};

type Rasterized = {
  width: number;
  height: number;
  ppm: number;
  labels: Int16Array;
  colors: ThreadColor[];
  regions: Region[];
  actualWidthMm: number;
  actualHeightMm: number;
  droppedSmallRegions: number;
  tinyRegionCount: number;
  foregroundAreaPx: number;
};

const DEFAULT_MAX_COLORS = 6;
const DEFAULT_FILL_STITCH_MM = 2.6;
const DEFAULT_ROW_SPACING_MM = 0.4;
const DEFAULT_PULL_COMP_MM = 0.25;
const PREVIEW_BACKGROUND = '#f6f7fb';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHex(rgb: [number, number, number]) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function srgbToLinear(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(rgb: [number, number, number]): Lab {
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

function labDistance(a: Lab, b: Lab) {
  return (a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToUnits(xPx: number, yPx: number, width: number, height: number, ppm: number) {
  const unitScale = 10 / ppm;
  return {
    x: Math.round((xPx - width / 2) * unitScale),
    y: Math.round((yPx - height / 2) * unitScale),
  };
}

function maskIndex(width: number, x: number, y: number) {
  return y * width + x;
}

function getMask(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return mask[maskIndex(width, x, y)];
}

function setMask(mask: Uint8Array, width: number, x: number, y: number, value: number) {
  mask[maskIndex(width, x, y)] = value;
}

function majoritySmooth(labels: Int16Array, width: number, height: number, backgroundLabel: number) {
  const next = new Int16Array(labels);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const label = labels[maskIndex(width, x + dx, y + dy)];
          counts.set(label, (counts.get(label) || 0) + 1);
        }
      }
      let bestLabel = labels[maskIndex(width, x, y)];
      let bestCount = 0;
      for (const [label, count] of counts.entries()) {
        if (count > bestCount || (count === bestCount && label !== backgroundLabel)) {
          bestCount = count;
          bestLabel = label;
        }
      }
      if (bestCount >= 5) next[maskIndex(width, x, y)] = bestLabel;
    }
  }
  labels.set(next);
}

function chooseBackgroundLabel(labels: Int16Array, labs: Lab[], width: number, height: number) {
  const borderCounts = new Map<number, number>();
  const add = (x: number, y: number) => {
    const label = labels[maskIndex(width, x, y)];
    borderCounts.set(label, (borderCounts.get(label) || 0) + 1);
  };
  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    add(width - 1, y);
  }
  let bestLabel = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [label, count] of borderCounts.entries()) {
    const lab = labs[label];
    const score = count * 4 + lab.l * 2 - Math.abs(lab.a) - Math.abs(lab.b);
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  return bestLabel;
}

function buildKMeansPalette(samples: Array<{ rgb: [number, number, number]; lab: Lab }>, clusters: number) {
  const centroids: Lab[] = [];
  const sorted = [...samples].sort((a, b) => a.lab.l - b.lab.l);
  if (!sorted.length) return centroids;
  centroids.push(sorted[0].lab);
  while (centroids.length < clusters) {
    let bestSample = sorted[0];
    let bestDistance = -1;
    for (const sample of sorted) {
      const distance = Math.min(...centroids.map((centroid) => labDistance(sample.lab, centroid)));
      if (distance > bestDistance) {
        bestDistance = distance;
        bestSample = sample;
      }
    }
    centroids.push(bestSample.lab);
  }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, count: 0 }));
    for (const sample of sorted) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centroids.length; index += 1) {
        const distance = labDistance(sample.lab, centroids[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      const sum = sums[bestIndex];
      sum.l += sample.lab.l;
      sum.a += sample.lab.a;
      sum.b += sample.lab.b;
      sum.count += 1;
    }
    for (let index = 0; index < centroids.length; index += 1) {
      const sum = sums[index];
      if (!sum.count) continue;
      centroids[index] = {
        l: sum.l / sum.count,
        a: sum.a / sum.count,
        b: sum.b / sum.count,
      };
    }
  }
  return centroids;
}

function quantize(raw: Uint8Array, width: number, height: number, maxColors: number) {
  const labs: Lab[] = new Array(width * height);
  const samples: Array<{ rgb: [number, number, number]; lab: Lab }> = [];
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 6000)));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const rgb: [number, number, number] = [raw[offset], raw[offset + 1], raw[offset + 2]];
      const lab = rgbToLab(rgb);
      labs[y * width + x] = lab;
      if (x % sampleStep === 0 && y % sampleStep === 0) samples.push({ rgb, lab });
    }
  }

  const clusterCount = clamp(maxColors + 1, 2, 13);
  const centroids = buildKMeansPalette(samples, clusterCount);
  const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  const labels = new Int16Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const distance = labDistance(labs[index], centroids[centroidIndex]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = centroidIndex;
      }
    }
    labels[index] = best;
    const offset = index * 3;
    sums[best].r += raw[offset];
    sums[best].g += raw[offset + 1];
    sums[best].b += raw[offset + 2];
    sums[best].count += 1;
  }

  const paletteLabs = centroids.map((centroid, index) => ({
    ...centroid,
    rgb: sums[index].count
      ? [
        Math.round(sums[index].r / sums[index].count),
        Math.round(sums[index].g / sums[index].count),
        Math.round(sums[index].b / sums[index].count),
      ] as [number, number, number]
      : [255, 255, 255] as [number, number, number],
  }));

  return { labels, paletteLabs };
}

function removeSmallComponents(labels: Int16Array, width: number, height: number, backgroundLabel: number, minArea: number) {
  const visited = new Uint8Array(labels.length);
  let dropped = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (visited[start] || labels[start] === backgroundLabel) continue;
    const label = labels[start];
    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;
    while (queue.length) {
      const index = queue.pop()!;
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIndex = maskIndex(width, nx, ny);
        if (visited[neighborIndex] || labels[neighborIndex] !== label) continue;
        visited[neighborIndex] = 1;
        queue.push(neighborIndex);
      }
    }
    if (component.length >= minArea) continue;
    const borderCounts = new Map<number, number>();
    for (const index of component) {
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborLabel = labels[maskIndex(width, nx, ny)];
        if (neighborLabel === label) continue;
        borderCounts.set(neighborLabel, (borderCounts.get(neighborLabel) || 0) + 1);
      }
    }
    const replacement = [...borderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? backgroundLabel;
    for (const index of component) labels[index] = replacement;
    dropped += component.length;
  }
  return dropped;
}

function extractRegions(labels: Int16Array, width: number, height: number, colors: ThreadColor[], backgroundLabel: number) {
  const visited = new Uint8Array(labels.length);
  const regions: Region[] = [];
  let tinyRegionCount = 0;
  for (let start = 0; start < labels.length; start += 1) {
    if (visited[start] || labels[start] === backgroundLabel) continue;
    const label = labels[start];
    const queue = [start];
    const pixels: number[] = [];
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    while (queue.length) {
      const index = queue.pop()!;
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIndex = maskIndex(width, nx, ny);
        if (visited[neighborIndex] || labels[neighborIndex] !== label) continue;
        visited[neighborIndex] = 1;
        queue.push(neighborIndex);
      }
    }
    if (pixels.length < 18) tinyRegionCount += 1;
    const regionWidth = maxX - minX + 1;
    const regionHeight = maxY - minY + 1;
    const mask = new Uint8Array(regionWidth * regionHeight);
    for (const index of pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      setMask(mask, regionWidth, x - minX, y - minY, 1);
    }
    regions.push({
      id: `r-${regions.length + 1}`,
      colorIndex: label,
      color: colors[label],
      mask,
      width: regionWidth,
      height: regionHeight,
      offsetX: minX,
      offsetY: minY,
      areaPx: pixels.length,
      bounds: { minX, minY, maxX, maxY },
      centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
    });
  }
  return { regions, tinyRegionCount };
}

function dilateMask(region: Region, radiusPx: number) {
  if (radiusPx <= 0) return region;
  const width = region.width + radiusPx * 2;
  const height = region.height + radiusPx * 2;
  const mask = new Uint8Array(width * height);
  const radiusSquared = radiusPx * radiusPx;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if (!getMask(region.mask, region.width, region.height, x, y)) continue;
      for (let dy = -radiusPx; dy <= radiusPx; dy += 1) {
        for (let dx = -radiusPx; dx <= radiusPx; dx += 1) {
          if (dx * dx + dy * dy > radiusSquared) continue;
          setMask(mask, width, x + dx + radiusPx, y + dy + radiusPx, 1);
        }
      }
    }
  }
  return {
    ...region,
    mask,
    width,
    height,
    offsetX: region.offsetX - radiusPx,
    offsetY: region.offsetY - radiusPx,
  };
}

function maskPoints(region: Region) {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if (getMask(region.mask, region.width, region.height, x, y)) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

function pcaSlices(region: Region, stepPx: number) {
  const points = maskPoints(region);
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  const bins = new Map<number, { minV: number; maxV: number; sumU: number; count: number }>();
  for (const point of points) {
    const relX = point.x - meanX;
    const relY = point.y - meanY;
    const u = relX * cos + relY * sin;
    const v = -relX * sin + relY * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    const key = Math.round(u / stepPx);
    const bin = bins.get(key) || { minV: Number.POSITIVE_INFINITY, maxV: Number.NEGATIVE_INFINITY, sumU: 0, count: 0 };
    bin.minV = Math.min(bin.minV, v);
    bin.maxV = Math.max(bin.maxV, v);
    bin.sumU += u;
    bin.count += 1;
    bins.set(key, bin);
  }
  const slices = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, bin]) => {
      const u = bin.count ? bin.sumU / bin.count : key * stepPx;
      const centerV = (bin.minV + bin.maxV) / 2;
      const left = {
        x: meanX + u * cos - bin.minV * sin + region.offsetX,
        y: meanY + u * sin + bin.minV * cos + region.offsetY,
      };
      const right = {
        x: meanX + u * cos - bin.maxV * sin + region.offsetX,
        y: meanY + u * sin + bin.maxV * cos + region.offsetY,
      };
      const center = {
        x: meanX + u * cos - centerV * sin + region.offsetX,
        y: meanY + u * sin + centerV * cos + region.offsetY,
      };
      return { u, width: bin.maxV - bin.minV + 1, left, right, center };
    });
  return { slices, angle };
}

function traceTatami(region: Region, ppm: number, angleDeg: number, rowSpacingMm: number, stitchMm: number) {
  const centerX = region.width / 2;
  const centerY = region.height / 2;
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rowStep = Math.max(2, rowSpacingMm * ppm);
  const stitchStep = Math.max(4, stitchMm * ppm);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if (!getMask(region.mask, region.width, region.height, x, y)) continue;
      const relX = x - centerX;
      const relY = y - centerY;
      const u = relX * cos + relY * sin;
      const v = -relX * sin + relY * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  const points: Array<{ x: number; y: number }> = [];
  let rowIndex = 0;
  for (let v = minV; v <= maxV; v += rowStep, rowIndex += 1) {
    const segments: Array<{ start: number; end: number }> = [];
    let inSegment = false;
    let segmentStart = minU;
    let lastHit = minU;
    for (let u = minU; u <= maxU; u += 1) {
      const localX = Math.round(centerX + u * cos - v * sin);
      const localY = Math.round(centerY + u * sin + v * cos);
      const inside = getMask(region.mask, region.width, region.height, localX, localY) === 1;
      if (inside && !inSegment) {
        inSegment = true;
        segmentStart = u;
      }
      if (inside) lastHit = u;
      if (!inside && inSegment) {
        segments.push({ start: segmentStart, end: lastHit });
        inSegment = false;
      }
    }
    if (inSegment) segments.push({ start: segmentStart, end: lastHit });
    if (!segments.length) continue;
    const orderedSegments = rowIndex % 2 === 0 ? segments : [...segments].reverse();
    for (const segment of orderedSegments) {
      const direction = rowIndex % 2 === 0 ? 1 : -1;
      const start = direction > 0 ? segment.start : segment.end;
      const end = direction > 0 ? segment.end : segment.start;
      const offset = rowIndex % 2 === 0 ? 0 : stitchStep / 2;
      const rowPoints: Array<{ x: number; y: number }> = [];
      for (
        let u = start;
        direction > 0 ? u <= end : u >= end;
        u += direction * stitchStep
      ) {
        const adjusted = clamp(u + direction * offset, Math.min(segment.start, segment.end), Math.max(segment.start, segment.end));
        rowPoints.push({
          x: centerX + adjusted * cos - v * sin + region.offsetX,
          y: centerY + adjusted * sin + v * cos + region.offsetY,
        });
      }
      rowPoints.push({
        x: centerX + end * cos - v * sin + region.offsetX,
        y: centerY + end * sin + v * cos + region.offsetY,
      });
      points.push(...rowPoints);
    }
  }
  return points;
}

function planRegion(region: Region, width: number, height: number, ppm: number, angle: number, rowSpacingMm: number, fillStitchMm: number, pullCompMm: number): PlannedRegion {
  const dilated = dilateMask(region, Math.max(1, Math.round(pullCompMm * ppm)));
  const widthMm = (region.bounds.maxX - region.bounds.minX + 1) / ppm;
  const heightMm = (region.bounds.maxY - region.bounds.minY + 1) / ppm;
  const thinDimensionMm = Math.min(widthMm, heightMm);
  const longDimensionMm = Math.max(widthMm, heightMm);
  const aspect = longDimensionMm / Math.max(0.1, thinDimensionMm);

  let points: Array<{ x: number; y: number }> = [];
  let category: PlannedRegion['category'] = 'fill';

  if (thinDimensionMm < 1 && aspect > 3) {
    const { slices } = pcaSlices(region, Math.max(2, ppm * 0.6));
    points = slices.map((slice) => pointToUnits(slice.center.x, slice.center.y, width, height, ppm));
    category = 'running';
  } else if (thinDimensionMm >= 1 && thinDimensionMm <= 7 && aspect > 2.2) {
    const { slices } = pcaSlices(region, Math.max(3, ppm * 0.7));
    const satinPoints: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < slices.length; index += 1) {
      const edge = index % 2 === 0 ? slices[index].left : slices[index].right;
      satinPoints.push(pointToUnits(edge.x, edge.y, width, height, ppm));
    }
    points = satinPoints;
    category = 'satin';
  } else {
    const underlay = traceTatami(dilated, ppm, angle + 90, 1.2, 3.2)
      .map((point) => pointToUnits(point.x, point.y, width, height, ppm));
    const fill = traceTatami(dilated, ppm, angle, rowSpacingMm, fillStitchMm)
      .map((point) => pointToUnits(point.x, point.y, width, height, ppm));
    points = [...underlay, ...fill];
    category = 'fill';
  }

  if (!points.length) {
    points = [pointToUnits(region.centroid.x, region.centroid.y, width, height, ppm)];
  }

  return { region, start: points[0], points, category };
}

function lockStitches(target: { x: number; y: number }, toward: { x: number; y: number } | undefined) {
  if (!toward) return [target];
  const distance = Math.max(1, pointDistance(target, toward));
  const first = {
    x: Math.round(target.x + ((toward.x - target.x) * Math.min(3, distance)) / distance),
    y: Math.round(target.y + ((toward.y - target.y) * Math.min(3, distance)) / distance),
  };
  const second = {
    x: Math.round(target.x + ((toward.x - target.x) * Math.min(6, distance)) / distance),
    y: Math.round(target.y + ((toward.y - target.y) * Math.min(6, distance)) / distance),
  };
  return [target, first, target, second];
}

function orderRegionsForColor(regions: PlannedRegion[], current: { x: number; y: number }) {
  const remaining = [...regions];
  const ordered: PlannedRegion[] = [];
  let cursor = current;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const distance = pointDistance(cursor, remaining[index].start);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    cursor = next.points[next.points.length - 1];
  }
  return ordered;
}

function generateStitches(rasterized: Rasterized, angle: number, rowSpacingMm: number, fillStitchMm: number, pullCompMm: number) {
  const stitches: Stitch[] = [];
  const warnings: string[] = [];
  const current = { x: 0, y: 0 };
  let colorChanges = 0;
  let jumps = 0;
  let trims = 0;

  for (const color of rasterized.colors) {
    const planned = rasterized.regions
      .filter((region) => region.colorIndex === color.index)
      .map((region) => planRegion(region, rasterized.width, rasterized.height, rasterized.ppm, angle, rowSpacingMm, fillStitchMm, pullCompMm));
    if (!planned.length) continue;
    const ordered = orderRegionsForColor(planned, current);
    for (const plan of ordered) {
      if (plan.category !== 'fill' && plan.points.length < 3) {
        warnings.push(`${plan.region.color.name} contains a very short thin element; review manually for stitch direction.`);
      }
      const travel = pointDistance(current, plan.start);
      if (travel > 30) {
        if (stitches.length) {
          stitches.push({ x: current.x, y: current.y, command: 'trim', color: color.index });
          trims += 1;
        }
        stitches.push({ x: plan.start.x, y: plan.start.y, command: 'jump', color: color.index });
        jumps += 1;
      } else if (travel > 0) {
        stitches.push({ x: plan.start.x, y: plan.start.y, command: 'jump', color: color.index });
        jumps += 1;
      }
      const lockIn = lockStitches(plan.start, plan.points[1]);
      for (const point of lockIn) stitches.push({ x: point.x, y: point.y, command: 'stitch', color: color.index });
      for (const point of plan.points.slice(1)) stitches.push({ x: point.x, y: point.y, command: 'stitch', color: color.index });
      const end = plan.points[plan.points.length - 1];
      const previous = plan.points[plan.points.length - 2];
      const lockOut = lockStitches(end, previous).slice(1);
      for (const point of lockOut) stitches.push({ x: point.x, y: point.y, command: 'stitch', color: color.index });
      current.x = end.x;
      current.y = end.y;
    }
    const hasMoreColors = rasterized.colors.some((candidate) => candidate.index > color.index && rasterized.regions.some((region) => region.colorIndex === candidate.index));
    if (hasMoreColors) {
      stitches.push({ x: current.x, y: current.y, command: 'color-change', color: color.index });
      colorChanges += 1;
    }
  }

  stitches.push({ x: current.x, y: current.y, command: 'end', color: rasterized.colors[0]?.index ?? 0 });
  return { stitches, colorChanges, jumps, trims, warnings };
}

function splitLongCommands(stitches: Stitch[]) {
  const normalized: Stitch[] = [];
  let current = { x: 0, y: 0 };
  for (const stitch of stitches) {
    if (stitch.command === 'trim' || stitch.command === 'color-change' || stitch.command === 'end') {
      normalized.push(stitch);
      continue;
    }
    const maxDistance = stitch.command === 'jump' ? 121 : 70;
    const distance = pointDistance(current, stitch);
    if (distance <= maxDistance || distance === 0) {
      normalized.push(stitch);
      current = { x: stitch.x, y: stitch.y };
      continue;
    }
    const steps = Math.ceil(distance / maxDistance);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const next = {
        x: Math.round(current.x + (stitch.x - current.x) * t),
        y: Math.round(current.y + (stitch.y - current.y) * t),
        command: stitch.command,
        color: stitch.color,
      } satisfies Stitch;
      normalized.push(next);
    }
    current = { x: stitch.x, y: stitch.y };
  }
  return normalized;
}

function buildQa(stitches: Stitch[], colors: ThreadColor[], rasterized: Rasterized, extraWarnings: string[], colorChanges: number, jumps: number, trims: number): DigitizeQa {
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;
  let current = { x: 0, y: 0 };
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const threadCounts = new Map<number, number>();
  for (const stitch of stitches) {
    if (stitch.command === 'stitch') {
      const lengthMm = Math.hypot(stitch.x - current.x, stitch.y - current.y) / 10;
      minLength = Math.min(minLength, lengthMm);
      maxLength = Math.max(maxLength, lengthMm);
      threadCounts.set(stitch.color, (threadCounts.get(stitch.color) || 0) + 1);
    }
    if (stitch.command === 'stitch' || stitch.command === 'jump') {
      current = { x: stitch.x, y: stitch.y };
      minX = Math.min(minX, stitch.x);
      minY = Math.min(minY, stitch.y);
      maxX = Math.max(maxX, stitch.x);
      maxY = Math.max(maxY, stitch.y);
    }
  }
  const stitchCount = stitches.filter((stitch) => stitch.command === 'stitch').length;
  const stitchedWidthMm = Math.max(0.1, (maxX - minX) / 10);
  const stitchedHeightMm = Math.max(0.1, (maxY - minY) / 10);
  const areaCm2 = Math.max(0.01, (stitchedWidthMm * stitchedHeightMm) / 100);
  const densityPerCm2 = stitchCount / areaCm2;
  const warnings = [...extraWarnings];
  if (stitchedWidthMm < 20 || stitchedHeightMm < 20) warnings.push('Design under 20 mm on one side may lose detail when stitched.');
  if (densityPerCm2 > 70) warnings.push('High stitch density detected; fabric puckering risk is elevated.');
  if (colors.length > 6) warnings.push('More than 6 colors increases setup time and raises routing risk.');
  if (rasterized.droppedSmallRegions > 0) warnings.push(`${rasterized.droppedSmallRegions} tiny pixels were removed as speckles.`);
  if (rasterized.tinyRegionCount > 2) warnings.push('Multiple tiny details remain; small text/details under ~4 mm may blur.');

  const severeWarnings = warnings.filter((warning) => /blur|pucker|manual|tiny/i.test(warning)).length;
  const needsHumanReview = severeWarnings > 0 || rasterized.tinyRegionCount > 3 || colors.length > 8;
  const confidence = clamp(0.88 - severeWarnings * 0.16 - warnings.length * 0.04, 0.25, 0.92);
  const threadList: QaThreadSummary[] = colors.map((color) => ({
    colorIndex: color.index,
    hex: color.hex,
    name: color.name,
    stitchCount: threadCounts.get(color.index) || 0,
  }));

  return {
    stitchCount,
    colorChanges,
    trims,
    jumps,
    designWidthMm: Number(stitchedWidthMm.toFixed(1)),
    designHeightMm: Number(stitchedHeightMm.toFixed(1)),
    densityPerCm2: Number(densityPerCm2.toFixed(1)),
    minStitchLengthMm: Number((Number.isFinite(minLength) ? minLength : 0).toFixed(2)),
    maxStitchLengthMm: Number(maxLength.toFixed(2)),
    estimatedMinutesAt700Spm: Number((stitchCount / 700).toFixed(1)),
    threadList,
    warnings: [...new Set(warnings)],
    needsHumanReview,
    confidence,
  };
}

async function buildPreview(stitches: Stitch[], colors: ThreadColor[]) {
  const pathStitches = stitches.filter((stitch) => stitch.command === 'stitch' || stitch.command === 'jump');
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const stitch of pathStitches) {
    minX = Math.min(minX, stitch.x);
    minY = Math.min(minY, stitch.y);
    maxX = Math.max(maxX, stitch.x);
    maxY = Math.max(maxY, stitch.y);
  }
  const padding = 40;
  const width = Math.max(200, maxX - minX + padding * 2);
  const height = Math.max(200, maxY - minY + padding * 2);
  const translateX = padding - minX;
  const translateY = padding - minY;
  const polylines: string[] = [];
  const segmentsByColor = new Map<number, Array<Array<{ x: number; y: number }>>>();
  let currentSegment: Array<{ x: number; y: number }> = [];
  let currentColor = colors[0]?.index ?? 0;
  for (const stitch of stitches) {
    if (stitch.command === 'color-change') {
      if (currentSegment.length) {
        const list = segmentsByColor.get(currentColor) || [];
        list.push(currentSegment);
        segmentsByColor.set(currentColor, list);
        currentSegment = [];
      }
      currentColor = stitch.color + 1 < colors.length ? stitch.color + 1 : stitch.color;
      continue;
    }
    if (stitch.command === 'jump' || stitch.command === 'trim' || stitch.command === 'end') {
      if (currentSegment.length) {
        const list = segmentsByColor.get(currentColor) || [];
        list.push(currentSegment);
        segmentsByColor.set(currentColor, list);
        currentSegment = [];
      }
      continue;
    }
    currentSegment.push({ x: stitch.x + translateX, y: stitch.y + translateY });
  }
  if (currentSegment.length) {
    const list = segmentsByColor.get(currentColor) || [];
    list.push(currentSegment);
    segmentsByColor.set(currentColor, list);
  }

  for (const color of colors) {
    const segments = segmentsByColor.get(color.index) || [];
    for (const segment of segments) {
      if (segment.length < 2) continue;
      const points = segment.map((point) => `${point.x},${point.y}`).join(' ');
      polylines.push(`<polyline points="${points}" fill="none" stroke="${color.hex}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.95" />`);
    }
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${PREVIEW_BACKGROUND}" />`,
    ...polylines,
    '</svg>',
  ].join('');
  const previewPng = await sharp(Buffer.from(svg)).png().toBuffer();
  return { previewSvg: svg, previewPng };
}

async function rasterize(input: DigitizeInput): Promise<Rasterized> {
  const base = sharp(input.image, { failOn: 'none', density: 240 });
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Unable to read image dimensions.');

  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  const aspect = sourceWidth / sourceHeight;
  const requestedWidthMm = input.widthMm;
  let actualWidthMm = requestedWidthMm;
  let actualHeightMm = input.heightMm ?? requestedWidthMm / aspect;
  if (input.heightMm) {
    const fittedHeight = requestedWidthMm / aspect;
    if (fittedHeight > input.heightMm) {
      actualHeightMm = input.heightMm;
      actualWidthMm = actualHeightMm * aspect;
    } else {
      actualHeightMm = fittedHeight;
    }
  }

  const longestMm = Math.max(actualWidthMm, actualHeightMm);
  const ppm = Math.max(3, Math.min(10, Math.floor((input.maxLongestSidePx || 1200) / Math.max(1, longestMm))));
  const widthPx = Math.max(32, Math.round(actualWidthMm * ppm));
  const heightPx = Math.max(32, Math.round(actualHeightMm * ppm));

  const { data } = await base
    .flatten({ background: '#ffffff' })
    .resize(widthPx, heightPx, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maxColors = clamp(input.maxColors ?? DEFAULT_MAX_COLORS, 2, 12);
  const { labels, paletteLabs } = quantize(data, widthPx, heightPx, maxColors);
  const backgroundLabel = chooseBackgroundLabel(labels, paletteLabs, widthPx, heightPx);

  majoritySmooth(labels, widthPx, heightPx, backgroundLabel);
  const droppedSmallRegions = removeSmallComponents(labels, widthPx, heightPx, backgroundLabel, input.minSpecklePx ?? Math.max(10, Math.round(ppm * 0.8)));
  majoritySmooth(labels, widthPx, heightPx, backgroundLabel);

  const labelToColor = new Map<number, number>();
  const colors: ThreadColor[] = [];
  for (let index = 0; index < paletteLabs.length; index += 1) {
    if (index === backgroundLabel) continue;
    const rgb = paletteLabs[index].rgb;
    const colorIndex = colors.length;
    labelToColor.set(index, colorIndex);
    colors.push({
      index: colorIndex,
      rgb,
      hex: rgbToHex(rgb),
      name: `Thread ${colorIndex + 1} ${rgbToHex(rgb).toUpperCase()}`,
    });
  }

  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === backgroundLabel) continue;
    labels[index] = labelToColor.get(labels[index]) ?? -1;
  }

  const { regions, tinyRegionCount } = extractRegions(labels, widthPx, heightPx, colors, backgroundLabel);
  const foregroundAreaPx = regions.reduce((sum, region) => sum + region.areaPx, 0);
  return {
    width: widthPx,
    height: heightPx,
    ppm,
    labels,
    colors,
    regions,
    actualWidthMm,
    actualHeightMm,
    droppedSmallRegions,
    tinyRegionCount,
    foregroundAreaPx,
  };
}

export async function digitizeLogo(input: DigitizeInput): Promise<DigitizeResult> {
  if (!Buffer.isBuffer(input.image) || !input.image.length) throw new Error('digitizeLogo requires a non-empty image buffer.');
  if (!Number.isFinite(input.widthMm) || input.widthMm <= 0) throw new Error('widthMm must be a positive number.');

  const rasterized = await rasterize(input);
  if (!rasterized.colors.length || !rasterized.regions.length) {
    throw new Error('No foreground regions were detected after background removal.');
  }

  const angle = Number.isFinite(input.angle) ? Number(input.angle) : 45;
  const rowSpacingMm = Number.isFinite(input.rowSpacingMm) ? Number(input.rowSpacingMm) : DEFAULT_ROW_SPACING_MM;
  const fillStitchMm = Number.isFinite(input.fillStitchMm) ? Number(input.fillStitchMm) : DEFAULT_FILL_STITCH_MM;
  const pullCompMm = Number.isFinite(input.pullCompMm) ? Number(input.pullCompMm) : DEFAULT_PULL_COMP_MM;

  const generated = generateStitches(rasterized, angle, rowSpacingMm, fillStitchMm, pullCompMm);
  const normalizedStitches = splitLongCommands(generated.stitches);
  const qa = buildQa(
    normalizedStitches,
    rasterized.colors,
    rasterized,
    generated.warnings,
    generated.colorChanges,
    generated.jumps,
    generated.trims,
  );
  const files = encodeAllFormats(normalizedStitches, rasterized.colors, input.designName || 'MJIC');
  const preview = await buildPreview(normalizedStitches, rasterized.colors);

  return {
    stitches: normalizedStitches,
    colors: rasterized.colors,
    qa,
    files,
    previewPng: preview.previewPng,
    previewSvg: preview.previewSvg,
  };
}

export type { DigitizeInput, DigitizeQa, DigitizeResult, Stitch, ThreadColor } from './types.ts';
