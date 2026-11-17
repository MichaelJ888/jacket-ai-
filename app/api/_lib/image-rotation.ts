/**
 * Dynamic Image Rotation System
 * Reads all images from public/images/ and rotates them by category.
 * Never posts the same image twice in a row; ensures category matching.
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

// In-memory state for image rotation
const imageUseCount: Map<string, number> = new Map();
const lastSelectedImage: Map<ProductCategory, string> = new Map();

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
 * Load all available image assets for a given category.
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

  return assets;
}

/**
 * Rotate images: pick the least-used image for the category,
 * but never the same image twice in a row.
 */
export function selectNextImage(category: ProductCategory): ImageAsset | null {
  const assets = getImagesForCategory(category);
  if (!assets.length) return null;

  const lastUrl = lastSelectedImage.get(category);
  let bestImage: ImageAsset | null = null;
  let bestCount = Infinity;

  for (const image of assets) {
    // Skip the last image (no immediate repeats)
    if (image.url === lastUrl) continue;

    const count = imageUseCount.get(image.url) || 0;
    if (count < bestCount) {
      bestImage = image;
      bestCount = count;
    }
  }

  // If all available images except one have been used, allow repeating (but not the last one)
  if (!bestImage && assets.length > 1) {
    for (const image of assets) {
      if (image.url === lastUrl) continue;
      return image;
    }
  }

  // If only one image exists, return it (even if it's the same as last)
  if (!bestImage && assets.length === 1) {
    return assets[0];
  }

  if (bestImage) {
    lastSelectedImage.set(category, bestImage.url);
  }

  return bestImage;
}

/**
 * Track and increment image usage count.
 */
export function recordImageUsage(category: ProductCategory, filename: string): void {
  const assets = getImagesForCategory(category);
  const image = assets.find((a) => a.filename === filename);
  if (image) {
    const current = imageUseCount.get(image.url) || 0;
    imageUseCount.set(image.url, current + 1);
  }
}

/**
 * Reset usage counter for all images (call this periodically to allow re-use)
 */
export function resetImageUsage(): void {
  imageUseCount.clear();
  lastSelectedImage.clear();
}
