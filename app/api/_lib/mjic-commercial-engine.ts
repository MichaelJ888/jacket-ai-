/**
 * MJIC Commercial Ad Engine: Rotating category generator with OpenRouter SEO captions,
 * Replicate Flux/video, 10-trust FAQs, 3-tier hashtag matrix, and keyword mirroring.
 * 
 * Zero-local-load: all AI calls via direct OpenRouter API (OpenAI-compatible) and Replicate.
 */

import { fetchWithRetry } from './integrations.ts';

export type ProductCategory =
  | 'varsity-jackets'
  | 'corporate-uniforms'
  | 'school-uniforms'
  | 'custom-bags'
  | 'corporate-giveaways'
  | 'safety-jackets';

export interface CommercialAdConfig {
  category: ProductCategory;
  slotKind: 'video' | 'picture';
  catalogImage?: string;
  logoUrl?: string;
}

export interface CommercialAd {
  caption: string;
  hashtags: string[];
  videoPrompt: string | null;
  keywordPhrase: string;
}

// Category rotation: each index ensures no consecutive repeats in the queue.
const CATEGORY_ORDER: ProductCategory[] = [
  'varsity-jackets',
  'corporate-uniforms',
  'school-uniforms',
  'custom-bags',
  'corporate-giveaways',
  'safety-jackets',
];

// Tier 1: always present (5 hashtags).
const TIER1_HASHTAGS = [
  '#MJIC',
  '#JacketsAndMore',
  '#CustomJacketsPhilippines',
  '#CorporateUniformsPH',
  '#BulkApparelManufacturer',
];

// Tier 2 & 3 by category (rotating).
const CATEGORY_HASHTAGS: Record<ProductCategory, string[]> = {
  'varsity-jackets': ['#VarsityJacketsPH', '#CustomizedJacketsPH', '#WindbreakerJacketPH', '#GarmentManufacturerPhilippines', '#DirectSupplierPH'],
  'corporate-uniforms': ['#SchoolUniformSupplier', '#CompanyUniformsPhilippines', '#PoloShirtSupplierPH', '#MetroManilaSupplier', '#B2BPhilippines'],
  'school-uniforms': ['#SchoolUniformSupplier', '#CompanyUniformsPhilippines', '#PoloShirtSupplierPH', '#MetroManilaSupplier', '#B2BPhilippines'],
  'custom-bags': ['#CustomBagsPhilippines', '#CorporateGiveawaysPH', '#ComputerizedEmbroideryPH', '#AntipoloGarmentFactory', '#DirectSupplierPH'],
  'corporate-giveaways': ['#CustomBagsPhilippines', '#CorporateGiveawaysPH', '#ComputerizedEmbroideryPH', '#AntipoloGarmentFactory', '#DirectSupplierPH'],
  'safety-jackets': ['#SafetyWearPH', '#ReflectorizedApparelPH', '#WorkwearSupplierPhilippines', '#GarmentManufacturerPhilippines', '#DirectSupplierPH'],
};

// SEO keyword mirroring for Sentence 1.
const KEYWORD_PHRASES: Record<ProductCategory, string> = {
  'varsity-jackets': 'Direct Custom Varsity & Bomber Jackets Philippines manufacturer',
  'corporate-uniforms': 'Trusted Corporate & Executive Uniforms Philippines factory supplier',
  'school-uniforms': 'Direct School & Academic Uniforms Philippines manufacturer',
  'custom-bags': 'Direct Custom Bags & Corporate Giveaways Philippines supplier',
  'corporate-giveaways': 'Direct Corporate Giveaways & Custom Merchandise Philippines manufacturer',
  'safety-jackets': 'Direct Reflectorized Safety Jackets Philippines supplier',
};

// 10 B2B Trust FAQs for context injection.
export const MJIC_TRUST_FAQS = `
FAQ: Why MJIC?
✅ Direct Garment Manufacturer since 2004 (25+ years experience)
✅ Factory-Direct Wholesale Rates (no middleman markups)
✅ FREE Digital Mock-Up with Your Logo
✅ FREE Delivery within Metro Manila
✅ FREE Actual Pre-Production Sample for 100+ pcs Orders
✅ Guaranteed On-Time Bulk Delivery Nationwide
✅ Minimum Order: 20 pieces (bulk-friendly)
✅ Lead Time: 15–25 days for most custom orders
✅ Full In-House: Computerized Embroidery, DTF, Sublimation, Stitching
✅ Sizing: XS–5XL, Unisex & Custom Fits
✅ Payment Terms: 50/50 (DP on order, FP on delivery)
✅ Phone Support: Ms. May Anne (Smart 0920 695 9167 | Globe 0997 411 4594)
`;

// Static trust block appended to every caption.
const TRUST_BLOCK = `
🏆 WHY 500+ COMPANIES & SCHOOLS TRUST MJIC:
✅ Direct Garment Manufacturer since 2004 (Factory-Direct Wholesale Rates)
✅ FREE Digital Mock-Up With Your Logo
✅ FREE Delivery within Metro Manila
✅ FREE Actual Pre-Production Sample for 100+ pcs Orders
✅ Guaranteed On-Time Bulk Delivery Nationwide

📍 Workshop: #22 Bayabas St., Elmar's Subd., Brgy. Cupang, Antipolo City
🌐 Website & Formal Quote: https://jacketsandmore.com/
📞 Smart: 0920 695 9167 | Globe: 0997 411 4594 | Look for Ms. May Anne
`;

export function getNextCategory(lastCategory?: ProductCategory): ProductCategory {
  if (!lastCategory) return CATEGORY_ORDER[0];
  const idx = CATEGORY_ORDER.indexOf(lastCategory);
  if (idx < 0) return CATEGORY_ORDER[0];
  return CATEGORY_ORDER[(idx + 1) % CATEGORY_ORDER.length];
}

export function buildHashtags(category: ProductCategory): string[] {
  const tier1 = [...TIER1_HASHTAGS];
  const categoryTier = CATEGORY_HASHTAGS[category] || [];
  // Combine Tier1 (5) + Tier2 (5) = 10, but cap at 10 total.
  const combined = [...tier1, ...categoryTier];
  return combined.slice(0, 10);
}

export async function generateCommercialAd(config: CommercialAdConfig): Promise<CommercialAd> {
  const keywordPhrase = KEYWORD_PHRASES[config.category];
  const categoryHashtags = buildHashtags(config.category);
  
  // OpenRouter prompt: Sentence 1 must include the SEO keyword phrase, then FOMO hook + 3 benefits.
  const prompt = `You are MJIC's B2B social media manager (Philippine direct manufacturer, 25+ years, factory in Antipolo).
Write a Taglish/English post for companies, schools, NGOs, and fan clubs:
- Sentence 1 MUST start with: "${keywordPhrase}" (include this phrase exactly)
- Then: immediate FOMO hook (1 line) with an emotional reason to order NOW
- 3 practical benefits (bullets or inline)
- Close with: "Request your FREE mock-up and 100+ pcs sample today!"
- NO invented prices, discounts, certifications, or lead-time promises
- NO phone numbers (we append them automatically)

Context: This is for the ${config.category} category.

FAQ Context (use as background, do NOT repeat word-for-word):
${MJIC_TRUST_FAQS}

Your response MUST be only the caption text, no metadata.`;

  try {
    // Call OpenRouter API directly (OpenAI-compatible endpoint).
    const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || ''}`,
        'HTTP-Referer': 'https://jacketsandmore.com',
        'X-Title': 'MJIC Commercial Engine',
      },
      body: JSON.stringify({
        model: 'openrouter/auto', // Auto-selects cost-effective model
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 180,
      }),
    });

    if (!response) {
      throw new Error('OpenRouter API unavailable (null response)');
    }

    if (!response.ok) {
      throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content || '';

    return {
      caption: `${text}\n\n${TRUST_BLOCK}`,
      hashtags: categoryHashtags,
      videoPrompt: config.slotKind === 'video' ? buildVideoPrompt(config.category, config.catalogImage) : null,
      keywordPhrase,
    };
  } catch (err) {
    console.error('OpenRouter generation failed:', err);
    // Fallback: keyword phrase + minimal copy.
    return {
      caption: `${keywordPhrase}. Direct factory, fast turnaround, free samples. ${TRUST_BLOCK}`,
      hashtags: categoryHashtags,
      videoPrompt: config.slotKind === 'video' ? buildVideoPrompt(config.category, config.catalogImage) : null,
      keywordPhrase,
    };
  }
}

function buildVideoPrompt(category: ProductCategory, catalogImage?: string): string {
  // Replicate kwaivgi/kling-v2.1 or bytedance/seedance-1-pro. Structure: 0–3s macro stitching/embroidery,
  // 3–9s corporate/school team pride, 9–13s Antipolo factory QC seal, 13–15s urgent wholesale CTA.
  const categoryScenes: Record<ProductCategory, string> = {
    'varsity-jackets': 'Macro close-up of Tajima embroidery stitching a varsity jacket logo in navy thread (0-3s). Swift cut to a college sports team wearing custom jackets, running onto a field with pride and energy (3-9s). Pan to MJIC workshop floor in Antipolo: quality control inspector examining stitching under bright lighting, checking zippers, holding up finished jackets with approval stamp (9-13s). Final frame: text overlay "DIRECT FACTORY PRICING" + "ORDER NOW" with Ms. May Anne hotline banner, urgent CTA in yellow/gold (13-15s).',
    'corporate-uniforms': 'Macro embroidery/DTF transfer machine applying corporate logo to polo shirt (0-3s). Cut to a mid-size company team in matching polo uniforms at an office, confident and professional, shaking hands with clients (3-9s). Antipolo factory: seamstress inspecting collar seams, pressing finished polo, holding up quality-checked garment (9-13s). Final frame: "Factory Direct • Free Delivery Metro Manila • Order 100+ pcs Today" banner (13-15s).',
    'school-uniforms': 'Macro embroidery of school crest on white uniform polo (0-3s). School students in matching custom uniforms, walking hallways with pride, school flag in background (3-9s). MJIC Antipolo workshop: bulk uniform pieces being inspected, pressed, and folded for delivery (9-13s). "School Uniforms Supplier • Fast Turnaround • Free Delivery" CTA banner (13-15s).',
    'custom-bags': 'Macro embroidery of company logo on canvas tote bag (0-3s). Corporate team at a trade show or event carrying branded tote bags, handing them to clients, laughing and networking (3-9s). Antipolo factory: bulk bag production, logo embroidery, quality control check, finished products in branded boxes (9-13s). "Corporate Giveaways • Custom Bags • Direct Factory Pricing" urgent CTA (13-15s).',
    'corporate-giveaways': 'Macro embroidery/logo transfer on corporate giveaway item (mug, lanyard, pin) (0-3s). Corporate event: executives and employees proudly displaying branded giveaway items, smiling, networking (3-9s). MJIC workshop: batch production of giveaway items, QC seal, all items sorted and packaged (9-13s). "Corporate Giveaways • Wholesale Pricing • Order 100+ pcs Today" CTA banner (13-15s).',
    'safety-jackets': 'Macro close-up of reflectorized safety fabric being stitched onto orange safety jacket (0-3s). Road construction crew or security team wearing MJIC safety jackets, confident and visible, working on-site (3-9s). Antipolo factory: bulk safety jacket assembly, reflective tape application, final QC inspection under bright lights (9-13s). "Safety Jackets • Direct Manufacturer • Fast Delivery Nationwide" urgent CTA (13-15s).',
  };

  const baseScene = categoryScenes[category];
  const withImage = catalogImage ? `Use this reference image as style guide: ${catalogImage}. ` : '';
  return `${withImage}${baseScene} Cinematic vertical 9:16 video, 15 seconds, premium lighting, professional B2B tone. No watermarks. 4K 60fps if possible.`;
}

// Inject FAQs into AI system prompt for Sales Closer context.
export function injectFaqsIntoSystemPrompt(existingPrompt: string): string {
  return `${existingPrompt}\n\n## MJIC TRUST & FAQ CONTEXT (INCORPORATE INTO RESPONSES):\n${MJIC_TRUST_FAQS}`;
}
