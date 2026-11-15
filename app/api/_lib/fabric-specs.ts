// Enhanced fabric specifications: GSM weight, breathability, water resistance, and swatch metadata.

export interface FabricSpec {
  name: string;
  gsm?: number; // grams per square meter
  waterResistance?: 'none' | 'low' | 'medium' | 'high'; // water beading/repellency
  breathability?: 'low' | 'medium' | 'high'; // air permeability
  durability?: 'standard' | 'premium' | 'heavy-duty';
  description?: string;
  commonUses?: string[];
  swatchUrl?: string; // optional color/texture preview image URL
}

export const FABRIC_SPECS: Record<string, FabricSpec> = {
  'Microfiber': {
    name: 'Microfiber',
    gsm: 120,
    waterResistance: 'high',
    breathability: 'medium',
    durability: 'premium',
    description: 'Synthetic, ultra-soft, high water resistance. Premium feel.',
    commonUses: ['polos', 'jackets', 'corporate wear'],
  },
  'Michael Angelo': {
    name: 'Michael Angelo',
    gsm: 100,
    waterResistance: 'medium',
    breathability: 'medium',
    durability: 'standard',
    description: 'Lightweight synthetic blend. Comfortable and durable.',
    commonUses: ['polo shirts', 'casual wear'],
  },
  'Diamond Ripstop': {
    name: 'Diamond Ripstop',
    gsm: 85,
    waterResistance: 'high',
    breathability: 'high',
    durability: 'heavy-duty',
    description: 'Nylon ripstop weave. Tear-resistant, ideal for outdoor/heavy use.',
    commonUses: ['jackets', 'outdoor gear', 'workwear'],
  },
  'Twill': {
    name: 'Twill',
    gsm: 215,
    waterResistance: 'low',
    breathability: 'low',
    durability: 'standard',
    description: 'Diagonal weave cotton. Classic, durable, structured.',
    commonUses: ['pants', 'jackets', 'heavy wear'],
  },
  'Canvas / Twill': {
    name: 'Canvas / Twill',
    gsm: 280,
    waterResistance: 'low',
    breathability: 'low',
    durability: 'heavy-duty',
    description: 'Dense cotton weave. Very durable, structured, classic look.',
    commonUses: ['workwear', 'heavy-duty jackets', 'tote bags'],
  },
  'Brush Cotton': {
    name: 'Brush Cotton',
    gsm: 160,
    waterResistance: 'none',
    breathability: 'high',
    durability: 'standard',
    description: 'Soft cotton with brushed backing. Warm and comfortable.',
    commonUses: ['casual wear', 'hoodies', 'winter wear'],
  },
  'Marks & Spencer': {
    name: 'Marks & Spencer',
    gsm: 140,
    waterResistance: 'low',
    breathability: 'high',
    durability: 'premium',
    description: 'Premium cotton blend. Breathable and soft.',
    commonUses: ['casual wear', 'everyday apparel'],
  },
  'Stellini': {
    name: 'Stellini',
    gsm: 135,
    waterResistance: 'low',
    breathability: 'high',
    durability: 'premium',
    description: 'Italian-inspired cotton blend. Elegant and breathable.',
    commonUses: ['dress shirts', 'corporate wear'],
  },
  'Vellini': {
    name: 'Vellini',
    gsm: 130,
    waterResistance: 'medium',
    breathability: 'high',
    durability: 'premium',
    description: 'Smooth cotton-polyester blend. Soft and durable.',
    commonUses: ['casual wear', 'polos'],
  },
  'Honeycomb / Pique': {
    name: 'Honeycomb / Pique',
    gsm: 175,
    waterResistance: 'low',
    breathability: 'medium',
    durability: 'standard',
    description: 'Textured cotton weave. Classic polo look.',
    commonUses: ['polo shirts', 'casual shirts'],
  },
  'Dri-Fit / Performance Knit': {
    name: 'Dri-Fit / Performance Knit',
    gsm: 140,
    waterResistance: 'medium',
    breathability: 'high',
    durability: 'premium',
    description: 'Moisture-wicking synthetic. Ideal for athletic/active wear.',
    commonUses: ['sports wear', 'performance shirts', 'gym wear'],
  },
  'Oxford / Broadcloth': {
    name: 'Oxford / Broadcloth',
    gsm: 150,
    waterResistance: 'low',
    breathability: 'high',
    durability: 'standard',
    description: 'Crisp cotton weave. Professional and structured.',
    commonUses: ['dress shirts', 'corporate uniforms'],
  },
  'Softshell': {
    name: 'Softshell',
    gsm: 180,
    waterResistance: 'high',
    breathability: 'high',
    durability: 'premium',
    description: 'Flexible waterproof blend. Comfortable and protective.',
    commonUses: ['jackets', 'outdoor wear', 'active gear'],
  },
  'Scrub Suit Poly-Cotton': {
    name: 'Scrub Suit Poly-Cotton',
    gsm: 175,
    waterResistance: 'medium',
    breathability: 'medium',
    durability: 'premium',
    description: 'Medical-grade poly-cotton blend. Easy care and durable.',
    commonUses: ['medical scrubs', 'lab wear', 'healthcare'],
  },
  'Cotton Fleece': {
    name: 'Cotton Fleece',
    gsm: 240,
    waterResistance: 'none',
    breathability: 'low',
    durability: 'standard',
    description: 'Soft, warm fleece. Cozy interior, structured exterior.',
    commonUses: ['hoodies', 'sweatshirts', 'warm wear'],
  },
  'Taslan': {
    name: 'Taslan',
    gsm: 110,
    waterResistance: 'high',
    breathability: 'medium',
    durability: 'premium',
    description: 'Lightweight nylon blend. Water-resistant and quick-dry.',
    commonUses: ['jackets', 'windbreakers', 'rain gear'],
  },
  'Varsity Satin': {
    name: 'Varsity Satin',
    gsm: 120,
    waterResistance: 'none',
    breathability: 'medium',
    durability: 'standard',
    description: 'Glossy nylon satin. Athletic and smooth finish.',
    commonUses: ['jackets', 'sports apparel', 'team wear'],
  },
};

/**
 * Get fabric specifications by name.
 * Returns a spec object with GSM, water resistance, breathability, and common uses.
 */
export function getFabricSpec(fabricName: string): FabricSpec | null {
  return FABRIC_SPECS[fabricName] || null;
}

/**
 * Filter fabrics by water resistance level.
 */
export function fabricsByWaterResistance(level: 'high' | 'medium' | 'low'): FabricSpec[] {
  return Object.values(FABRIC_SPECS).filter((f) => f.waterResistance === level);
}

/**
 * Filter fabrics by breathability.
 */
export function fabricsByBreathability(level: 'high' | 'medium' | 'low'): FabricSpec[] {
  return Object.values(FABRIC_SPECS).filter((f) => f.breathability === level);
}

/**
 * Recommend fabrics for a given use case.
 */
export function recommendFabricsForUse(useCase: string): FabricSpec[] {
  return Object.values(FABRIC_SPECS).filter((f) => f.commonUses?.some((u) => u.toLowerCase().includes(useCase.toLowerCase())));
}
