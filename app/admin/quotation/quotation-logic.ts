import type { SignatoryKey } from '../../api/_lib/formal-quote';

export type QuoteForm = {
  customerName: string;
  customerContact: string;
  productName: string;
  quantity: string;
  marketUnitPrice: string;
  costPerPiece: string;
  fabric: string;
  frontLogos: string;
  backLogos: string;
  reversible: boolean;
  hood: boolean;
  threeTone: boolean;
  isTshirt: boolean;
  isFullSublimation: boolean;
  discountPesos: string;
  signatory: SignatoryKey;
};

export type DesignScan = {
  frontLogos: number;
  backLogos: number;
  reversible: boolean;
  hood: boolean;
  threeTone: boolean;
  isTshirt: boolean;
  isFullSublimation: boolean;
  notes: string;
};

export const EMPTY_FORM: QuoteForm = {
  customerName: '',
  customerContact: '',
  productName: '',
  quantity: '20',
  marketUnitPrice: '',
  costPerPiece: '',
  fabric: 'Microfiber',
  frontLogos: '1',
  backLogos: '0',
  reversible: false,
  hood: false,
  threeTone: false,
  isTshirt: false,
  isFullSublimation: false,
  discountPesos: '0',
  signatory: 'venezuela',
};

// Request body for POST /api/costing/formal-quote. Numbers are coerced here; the server re-validates.
export function toRequestBody(form: QuoteForm) {
  return {
    customerName: form.customerName.trim(),
    customerContact: form.customerContact.trim(),
    productName: form.productName.trim(),
    quantity: Number(form.quantity),
    marketUnitPrice: Number(form.marketUnitPrice),
    costPerPiece: Number(form.costPerPiece) || 0,
    fabric: form.fabric.trim(),
    frontLogos: Number(form.frontLogos) || 0,
    backLogos: Number(form.backLogos) || 0,
    reversible: form.reversible,
    hood: form.hood,
    threeTone: form.threeTone,
    isTshirt: form.isTshirt,
    isFullSublimation: form.isFullSublimation,
    discountPesos: Number(form.discountPesos) || 0,
    signatory: form.signatory,
  };
}

// Copies AI design-scan results into the form; the admin still reviews every value before saving.
export function applyDesignScan(form: QuoteForm, scan: DesignScan): QuoteForm {
  return {
    ...form,
    frontLogos: String(scan.frontLogos),
    backLogos: String(scan.backLogos),
    reversible: scan.reversible,
    hood: scan.hood,
    threeTone: scan.threeTone,
    isTshirt: scan.isTshirt,
    isFullSublimation: scan.isFullSublimation,
  };
}

export function formatPeso(value: number) {
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
