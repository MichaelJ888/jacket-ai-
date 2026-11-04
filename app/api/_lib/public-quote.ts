import { computeFormalQuote, type FormalQuote, type ProductClass } from './formal-quote.ts';
import { resolveFabricClass } from './fabric-class.ts';
import { seedPricelist, tierPrice, type Pricelist } from './pricelist-logic.ts';
import { MOQ_PIECES } from './pricing-logic.ts';

export const MAX_PUBLIC_QUANTITY = 100000;

export type PublicQuoteRequest = {
  customerName: string;
  customerContact: string | null;
  productName: string | null;
  category: string;
  quantity: number;
  fabric: string;
  productClass: ProductClass;
  frontLogos: number;
  backLogos: number;
  reversible: boolean;
  hood: boolean;
  threeTone: boolean;
  isFullSublimation: boolean;
};

export type PublicQuoteResult =
  | { kind: 'quote'; request: PublicQuoteRequest; quote: FormalQuote }
  | { kind: 'sales'; message: string };

export class PublicQuoteError extends Error {}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const flag = (value: unknown) => value === true;
const count = (value: unknown, max: number) => Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));

// Validates a public quote request and prices it strictly from the pricelist catalog and fabric rule.
// Any client-sent price or discount is ignored by design.
export function buildPublicQuote(body: Record<string, unknown>, catalog: Pricelist = seedPricelist()): PublicQuoteResult {
  const customerName = text(body.customerName, 120);
  if (customerName.length < 2) throw new PublicQuoteError('Please enter your name or company name.');
  const customerContact = text(body.customerContact, 120) || null;
  const productName = text(body.productName, 200) || null;

  const cat = catalog.categories.find((c) => c.active && c.key === String(body.category ?? ''));
  if (!cat) throw new PublicQuoteError('Please choose a product category.');
  const category = cat.key;

  // The MOQ is the category's own official tier floor when it has one (polo 5, lanyards 10), else the company-wide MOQ.
  const minQuantity = cat.tiers.length ? Math.min(...cat.tiers.map((tier) => tier.min)) : MOQ_PIECES;
  const quantity = Math.floor(Number(body.quantity));
  if (!Number.isFinite(quantity) || quantity < minQuantity) throw new PublicQuoteError(`Minimum order for ${cat.label} is ${minQuantity} pieces.`);
  if (quantity > MAX_PUBLIC_QUANTITY) throw new PublicQuoteError(`For orders above ${MAX_PUBLIC_QUANTITY.toLocaleString('en-US')} pieces, contact sales.`);

  const fabric = text(body.fabric, 120);
  if (!fabric) throw new PublicQuoteError('Please choose or type a fabric.');
  // Class is derived from the fabric by the strict rule; the customer cannot override it.
  const productClass = resolveFabricClass(fabric);

  const request: PublicQuoteRequest = {
    customerName,
    customerContact,
    productName,
    category,
    quantity,
    fabric,
    productClass,
    frontLogos: count(body.frontLogos, 4),
    backLogos: count(body.backLogos, 2),
    reversible: flag(body.reversible),
    hood: flag(body.hood),
    threeTone: flag(body.threeTone),
    isFullSublimation: flag(body.isFullSublimation),
  };

  const unit = tierPrice(cat.tiers, quantity);
  if (unit === null) {
    return {
      kind: 'sales',
      message: `${cat.label} pricing is confirmed by our sales team for this quantity. Send us your request and we will reply with a formal quote.`,
    };
  }

  const quote = computeFormalQuote({
    quantity,
    marketUnitPrice: unit,
    officialTierPrice: true,
    minQuantity,
    fabric,
    frontLogos: request.frontLogos,
    backLogos: request.backLogos,
    reversible: request.reversible,
    hood: request.hood,
    threeTone: request.threeTone,
    isTshirt: category === 't-shirt',
    isFullSublimation: request.isFullSublimation,
  });
  return { kind: 'quote', request, quote };
}
