// Loads the live giveaway catalog: seed tiers overlaid with any quote_pricelist rows for giveaway categories.
import { GIVEAWAY_CATEGORIES } from './mjic-pricelist.ts';
import { overlayGiveawayCatalog } from './giveaway-quote.ts';
import { loadPricelist } from './pricelist.ts';

const GIVEAWAY_KEYS = new Set(Object.keys(GIVEAWAY_CATEGORIES));

export async function loadGiveawayCatalog() {
  const all = await loadPricelist();
  return overlayGiveawayCatalog(all.categories.filter((cat) => GIVEAWAY_KEYS.has(cat.key)));
}
