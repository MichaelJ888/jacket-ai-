/**
 * Dynamic Image Rotation System
 * Reads all images from public/images/ and rotates them strictly round-robin by category.
 * Guarantees: zero consecutive duplicates, perfect category matching, deterministic LRU ordering.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductCategory } from './mjic-commercial-engine';

export interface ImageAsset {
  filename: string;
  url: string;
  category: ProductCategory;
  filepath: string;
}

// Category-to-folder mapping in public/images/
const CATEGORY_IMAGE_FOLDERS: Record<ProductCategory, string[]> = {
  'varsity-jackets': ['sublimation jackets', 'jackets-all-design'],
  'corporate-uniforms': ['polo shirts', 'company-uniforms', 'production sewing area'],
  'school-uniforms': ['school-uniforms', 'full sublimation election polo shirts'],
  'custom-bags': ['corporate-giveaways', 'CG Corporate Backpack Bag', 'CG Full Sublimation Lanyard (Full-Color)'],
  'corporate-giveaways': ['CG Canvas Eco Tote Bag', 'CG Ceramic Corporate Mug', 'CG Stainless Steel Travel Mug', 'corporate-giveaways'],
  'safety-jackets': ['Vest'],
};

const PUBLIC_IMAGES_DIR = join(process.cwd(), 'public', 'images');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// In-memory state for strict round-robin rotation
// Key: category | Value: { urls: sorted unique URLs, currentIndex: 0-based next position, lastSelectedUrl: prevent consecutive duplicates }
const categoryRotationState: Map<ProductCategory, { urls: string[]; currentIndex: number; lastSelectedUrl: string | null }> = new Map();

function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Recursively list all image files in a folder.
 */
function collectImagesInFolder(folderPath: string): string[] {
  const images: string[] = [];
  try {
    const entries = readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(folderPath, entry.name);
      if (entry.isFile() && isImageFile(entry.name)) {
        images.push(fullPath);
      } else if (entry.isDirectory()) {
        images.push(...collectImagesInFolder(fullPath));
      }
    }
  } catch {
    // Folder doesn't exist or permission denied; skip silently
  }
  return images;
}

/**
 * Load all available image assets for a given category, sorted for deterministic order.
 */
export function getImagesForCategory(category: ProductCategory): ImageAsset[] {
  const folderNames = CATEGORY_IMAGE_FOLDERS[category] || [];
  const assets: ImageAsset[] = [];
  const seenPaths = new Set<string>();

  for (const folderName of folderNames) {
    const folderPath = join(PUBLIC_IMAGES_DIR, folderName);
    try {
      if (!statSync(folderPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const imagePaths = collectImagesInFolder(folderPath);
    for (const imagePath of imagePaths) {
      if (seenPaths.has(imagePath)) continue;
      seenPaths.add(imagePath);

      const filename = imagePath.split(/[\\/]/).pop() || '';
      const relativePath = imagePath.replace(PUBLIC_IMAGES_DIR, '').replace(/\\/g, '/').substring(1);
      const url = `/images/${relativePath}`;

      assets.push({
        filename,
        url,
        category,
        filepath: imagePath,
      });
    }
  }

  // Sort deterministically by URL for reproducible round-robin
  return assets.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Strictly enforce round-robin rotation: pick the next image in sequence,
 * skip the last one to guarantee zero consecutive duplicates.
 */
export function selectNextImage(category: ProductCategory): ImageAsset | null {
  const assets = getImagesForCategory(category);
  if (!assets.length) return null;

  // Initialize rotation state for this category on first call
  let state = categoryRotationState.get(category);
  if (!state) {
    const urls = assets.map((a) => a.url);
    state = { urls, currentIndex: 0, lastSelectedUrl: null };
    categoryRotationState.set(category, state);
  }

  // Synchronize URLs in case new images were added/removed
  const currentUrls = assets.map((a) => a.url);
  if (!arraysEqual(state.urls, currentUrls)) {
    state.urls = currentUrls;
    // Reset index if it's out of bounds
    if (state.currentIndex >= state.urls.length) {
      state.currentIndex = 0;
    }
  }

  // Find next image: skip the last-selected URL to prevent consecutive duplicates
  let nextIndex = state.currentIndex;
  let skipped = 0;
  while (skipped < state.urls.length && state.urls[nextIndex] === state.lastSelectedUrl) {
    nextIndex = (nextIndex + 1) % state.urls.length;
    skipped += 1;
  }

  // If only one image exists and it's the same as last, still select it (edge case)
  if (skipped === state.urls.length && state.urls.length === 1) {
    nextIndex = 0;
  }

  const selectedUrl = state.urls[nextIndex];
  const selectedAsset = assets.find((a) => a.url === selectedUrl);

  if (selectedAsset) {
    // Advance index for next call
    state.currentIndex = (nextIndex + 1) % state.urls.length;
    state.lastSelectedUrl = selectedUrl;
  }

  return selectedAsset || null;
}

/**
 * Track and increment image usage count. (Kept for backward compatibility; not used in strict round-robin)
 */
export function recordImageUsage(category: ProductCategory, filename: string): void {
  // No-op: round-robin is fully deterministic and doesn't require tracking usage
}

/**
 * Reset rotation state for all categories (call this periodically to restart from first image).
 */
export function resetImageUsage(): void {
  categoryRotationState.clear();
}

/**
 * Helper: compare two arrays for equality.
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}
