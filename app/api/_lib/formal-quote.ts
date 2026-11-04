import { MOQ_PIECES, tierUnitPrice, volumeDiscountPct } from './pricing-logic.ts';

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

export const SIGNATORIES = [
  { name: 'Anne Manalo', title: 'Marketing Manager' },
  { name: 'Richard Venezuela', title: 'CEO' },
] as const;

export type ProductClass = 'A' | 'B';

export type FormalQuoteInput = {
  quantity: number;
  marketUnitPrice: number; // MOQ-rate garment price per piece, from the price list
  productClass: ProductClass;
  costPerPiece?: number;
  frontLogos: number;
  backLogos: number;
  reversible: boolean;
  hood: boolean;
  threeTone: boolean;
  isTshirt: boolean;
  isFullSublimation: boolean;
  discountPesos?: number; // fixed peso amount, subtracted from the final total
};

function whole(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function computeFormalQuote(input: FormalQuoteInput) {
  const quantity = whole(input.quantity);
  if (quantity < MOQ_PIECES) throw new Error(`Minimum order is ${MOQ_PIECES} pieces`);
  const market = Number(input.marketUnitPrice);
  if (!Number.isFinite(market) || market <= 0) throw new Error('marketUnitPrice must be a positive number');

  const frontLogos = whole(input.frontLogos);
  const backLogos = whole(input.backLogos);
  const garmentUnit = tierUnitPrice(market, quantity, Number(input.costPerPiece) || 0);

  const surcharge = input.productClass === 'A' && !input.isFullSublimation ? CLASS_A_SURCHARGE : 0;
  const extraFront = Math.max(0, frontLogos - 1) * EXTRA_FRONT_LOGO;
  const backCharge = backLogos * EXTRA_BACK_LOGO;
  const reversible = input.reversible ? REVERSIBLE_FEE : 0;
  const hood = input.hood ? HOOD_FEE : 0;
  const threeTone = input.threeTone && !input.isTshirt ? THREE_TONE_FEE : 0;

  const addOnsPerPiece = surcharge + extraFront + backCharge + reversible + hood + threeTone;
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

  return {
    quantity,
    productClass: input.productClass,
    volumeDiscountPct: volumeDiscountPct(quantity),
    garmentUnit,
    addOns: {
      classASurcharge: surcharge,
      extraFrontLogos: extraFront,
      backLogos: backCharge,
      reversible,
      hood,
      threeTone,
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
    signatures: SIGNATORIES.map((s) => ({ ...s, line: `______________________\n${s.name}\n${s.title}` })),
  };
}

export type FormalQuote = ReturnType<typeof computeFormalQuote>;
