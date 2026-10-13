import { getSetting } from './ceo-control';
import { sanitizePageKey } from './ceo-policy';

// Brand per ManyChat page_identifier. Env MJIC_PAGE_BRANDS is the base; the CEO bot's set_page_brand tool overrides it
// through the ceo_settings table ('page_brands'), so new Pages need no redeploy.
async function loadBrands(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const raw of [process.env.MJIC_PAGE_BRANDS, await getSetting('page_brands', '')]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string' && value.trim()) merged[sanitizePageKey(key)] = value.trim().slice(0, 80);
    } catch {
      // ignore malformed JSON
    }
  }
  return merged;
}

export async function listPageBrands() {
  return loadBrands();
}

export async function getPageBrand(page: string): Promise<string | undefined> {
  if (!page) return undefined;
  return (await loadBrands())[page];
}

export function brandAddendum(brand?: string) {
  if (!brand) return '';
  return `\n\nPAGE CONTEXT: This customer reached us through the "${brand}" Facebook/Instagram page. Refer to the business as "${brand}" when naming the page or branch. All prices, policies and numbers in your instructions still apply unchanged; never invent branch-specific prices or addresses.`;
}
