import { resolveFabricClass, type FabricClass } from './fabric-class.ts';
import { MOQ_PIECES, costFloorPrice, tierUnitPrice, volumeDiscountPct } from './pricing-logic.ts';

// Formal quotation rules (peso amounts, per piece unless noted).
export const CLASS_A_SURCHARGE = 300;
export const EXTRA_FRONT_LOGO = 65;
export const EXTRA_BACK_LOGO = 150;
export const REVERSIBLE_FEE = 400;
export const HOOD_FEE = 100;
export const THREE_TONE_FEE = 100;
export const PROGRAM_FEE_PER_LOGO = 1000; // flat, per logo location, not per piece
export const PROGRAM_FEE_MAX_QTY = 300; // program fee applies only up to this quantity
export const DEPOSIT_PCT = 50;

export const SIGNATORIES = {
  manalo: { name: 'May Anne E. Manalo', title: 'Marketing Manager', image: '/images/signatures/manalo.jpg' },
  venezuela: { name: 'Richard Venezuela', title: 'CEO', image: '/images/signatures/venezuela.jpg' },
} as const;
export type SignatoryKey = keyof typeof SIGNATORIES;
export const DEFAULT_SIGNATORY: SignatoryKey = 'venezuela';

export const VALID_DAYS = 30;
export const PAYMENT_DETAILS = [
  'BPI Savings Acct. | Acct. name: Richard Venezuela | Acct. no.: 4129447058',
  'GCash: 09292271761 (Richard Venezuela)',
  'Please send payment slip/screenshot for verification, thank you.',
] as const;

// Verbatim from the CG Venezuela Enterprises formal quotation standard. Do not reword.
export const TERMS = [
  'This Quotation Sheet must be signed and emailed back to CG Venezuela Enterprises after a purchase order is filled.',
  'The Quotation Number must be referenced on all purchase orders sent to CG Venezuela Enterprises.',
  'Product payment should be processed and funds be made available on the agreed upon date. Otherwise, CG Venezuela Enterprises will automatically charge an additional penalty of 3%/month on the total contract price of the project. Continual refusal to release payment will force CG Venezuela Enterprises to take applicable legal actions.',
] as const;

export const PAYMENT_TERMS = '50% downpayment & 50% upon delivery';

export type ProductClass = FabricClass;

export type FormalQuoteInput = {
  quantity: number;
  marketUnitPrice: number; // MOQ-rate garment price per piece, from the price list
  // true: marketUnitPrice is already the official tier price for this quantity, so no volume discount is applied again.
  officialTierPrice?: boolean;
  // Minimum accepted quantity. Defaults to the company-wide MOQ; official tier tables can set a lower floor (e.g. polo at 5).
  minQuantity?: number;
  // Class is derived from the fabric (see fabric-class.ts); it is never supplied directly.
  fabric: string;
  costPerPiece?: number;
  frontLogos: number;
  backLogos: number;
  reversible: boolean;
  hood: boolean;
  threeTone: boolean;
  isTshirt: boolean;
  isFullSublimation: boolean;
  discountPesos?: number; // fixed peso amount, subtracted from the final total
  signatory?: SignatoryKey;
  // Modular customization add-ons (embroidery, vinyl, screen print, etc.), per piece. See MODULAR_ADD_ONS in pricelist-logic.ts.
  modularAddOnsPerPiece?: number;
};

function whole(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function computeFormalQuote(input: FormalQuoteInput) {
  const quantity = whole(input.quantity);
  const minQuantity = whole(input.minQuantity) || MOQ_PIECES;
  if (quantity < minQuantity) throw new Error(`Minimum order is ${minQuantity} pieces`);
  const market = Number(input.marketUnitPrice);
  if (!Number.isFinite(market) || market <= 0) throw new Error('marketUnitPrice must be a positive number');

  const frontLogos = whole(input.frontLogos);
  const backLogos = whole(input.backLogos);
  const cost = Number(input.costPerPiece) || 0;
  const garmentUnit = input.officialTierPrice
    ? Math.max(Math.ceil(market), costFloorPrice(cost))
    : tierUnitPrice(market, quantity, cost);

  const productClass = resolveFabricClass(input.fabric);
  const surcharge = productClass === 'A' && !input.isFullSublimation ? CLASS_A_SURCHARGE : 0;
  const extraFront = Math.max(0, frontLogos - 1) * EXTRA_FRONT_LOGO;
  const backCharge = backLogos * EXTRA_BACK_LOGO;
  const reversible = input.reversible ? REVERSIBLE_FEE : 0;
  const hood = input.hood ? HOOD_FEE : 0;
  const threeTone = input.threeTone && !input.isTshirt ? THREE_TONE_FEE : 0;

  const modularPerPiece = Math.max(0, whole(input.modularAddOnsPerPiece));
  const addOnsPerPiece = surcharge + extraFront + backCharge + reversible + hood + threeTone + modularPerPiece;
  const unitPrice = garmentUnit + addOnsPerPiece;

  // The first front logo is included in the program; every other logo location is charged.
  const logoLocations = frontLogos + backLogos;
  const chargeableLogos = frontLogos >= 1 ? logoLocations - 1 : logoLocations;
  const programFee = quantity <= PROGRAM_FEE_MAX_QTY ? chargeableLogos * PROGRAM_FEE_PER_LOGO : 0;

  const garmentSubtotal = garmentUnit * quantity;
  const addOnSubtotal = addOnsPerPiece * quantity;
  const subtotal = garmentSubtotal + addOnSubtotal + programFee;

  const requestedDiscount = Math.max(0, Math.floor(Number(input.discountPesos) || 0));
  const discount = Math.min(requestedDiscount, subtotal);
  const total = subtotal - discount;
  const deposit = Math.ceil((total * DEPOSIT_PCT) / 100);
  const signatoryKey: SignatoryKey = input.signatory && input.signatory in SIGNATORIES ? input.signatory : DEFAULT_SIGNATORY;
  const signatory = { key: signatoryKey, ...SIGNATORIES[signatoryKey] };

  return {
    quantity,
    fabric: String(input.fabric ?? '').trim(),
    productClass,
    volumeDiscountPct: input.officialTierPrice ? 0 : volumeDiscountPct(quantity),
    garmentUnit,
    addOns: {
      classASurcharge: surcharge,
      extraFrontLogos: extraFront,
      backLogos: backCharge,
      reversible,
      hood,
      threeTone,
      modularAddOns: modularPerPiece,
      perPiece: addOnsPerPiece,
    },
    unitPrice,
    garmentSubtotal,
    addOnSubtotal,
    programFee,
    subtotal,
    discount,
    total,
    depositPct: DEPOSIT_PCT,
    deposit,
    balance: total - deposit,
    validDays: VALID_DAYS,
    paymentTerms: PAYMENT_TERMS,
    paymentDetails: PAYMENT_DETAILS,
    terms: TERMS,
    signatory,
  };
}

export type FormalQuote = ReturnType<typeof computeFormalQuote>;
