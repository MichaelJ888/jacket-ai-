import { NextResponse } from 'next/server';

function toText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function normalizeStyles(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildCreativePrompt(input: {
  clientName: string;
  jacketStyle: string;
  logoUrl?: string;
  colorway?: string;
  audience?: string;
  callToAction?: string;
  jacketStyles?: string[];
}) {
  const styles = input.jacketStyles?.length ? input.jacketStyles.join(', ') : input.jacketStyle || 'corporate jackets, bomber jackets, varsity jackets, windbreakers, and hoodies';
  const base = [
    'Create a cinematic social media ad for MJIC custom jackets and apparel.',
    `Feature multiple premium jacket styles in one campaign: ${styles}.`,
    `Brand/client: ${input.clientName || 'MJIC client'}.`,
    `Colorway: ${input.colorway || 'navy, charcoal, maroon, black, and executive neutral tones'}.`,
    `Audience: ${input.audience || 'corporate teams, schools, uniforms, and brand-focused customers'}.`,
    `Call to action: ${input.callToAction || 'Request a custom proposal today'}.`,
  ].join(' ');

  const socialVideoScene = [
    'Show attractive models wearing each jacket style in a lifestyle shoot with confident poses, natural movement, and premium fashion styling.',
    'Include realistic AI-enhanced visuals that look authentic and polished, not cartoonish.',
    'Show the production area in a realistic factory environment: fabric cutting tables, garment pattern design on computer screens, embroidery station, screen printing station, and seamstresses sewing different jackets and items.',
    'Blend the high-end fashion shots with behind-the-scenes manufacturing footage in a smooth cinematic transition.',
    'Keep the lighting premium and commercial, with shallow depth of field, soft cinematic motion, subtle smoke or studio haze, and highly polished branding.',
    'Use realistic product close-ups on fabrics, stitching details, logo embroidery, zippers, labels, and finishing touches.',
    'Make the visuals feel luxury, trustworthy, and manufacturing-ready for serious business clients.',
  ].join(' ');

  if (input.logoUrl) {
    return `${base} ${socialVideoScene} Add the client logo as a crisp embroidered logo or chest branding mark. Keep the logos clean, high-contrast, and professionally placed on each jacket.`;
  }

  return `${base} ${socialVideoScene} Keep it brand-safe and polished with a premium corporate feel.`;
}

function buildVoiceoverScript(input: {
  clientName: string;
  jacketStyle: string;
  audience?: string;
  callToAction?: string;
  jacketStyles?: string[];
}) {
  const styles = input.jacketStyles?.length ? input.jacketStyles.join(', ') : input.jacketStyle || 'custom jackets and uniforms';
  return [
    'Hi everyone, this is MJIC, your trusted custom apparel and jacket manufacturer.',
    `For businesses, schools, and growing brands who want premium ${styles}, we create garments that look sharp, feel durable, and represent your identity with confidence.`,
    'From design and fabric cutting to embroidery, printing, and final stitching, every step is handled by our experienced team with quality and precision in mind.',
    'Our process blends real craftsmanship with modern digital design, giving clients a reliable production flow from concept to finished product.',
    'Whether you need corporate uniforms, team jackets, promotional apparel, or custom garments for your brand, we build solutions that are stylish, practical, and built to last.',
    `Trust MJIC for your next ${input.audience || 'corporate apparel and custom garment'} project. ${input.callToAction || 'Message us today for a custom proposal and let us help you create your next standout design.'}`,
  ].join(' ');
}

function buildSocialPostingPlan(jacketStyles: string[]) {
  const styles = jacketStyles.length ? jacketStyles : ['Corporate jacket', 'Windbreaker', 'Bomber jacket'];
  return [
    {
      platform: 'Instagram Reels',
      format: '15-30 sec vertical ad',
      caption: `Premium ${styles.slice(0, 2).join(' and ')} styles from MJIC. Custom-built for teams, brands, and corporate identity. DM us for a custom proposal.`,
      hashtags: ['#MJIC', '#CustomJackets', '#CorporateWear', '#MadeInPH'],
    },
    {
      platform: 'Facebook Ads',
      format: 'Story + feed cutdown',
      caption: `Trusted custom garment partner for ${styles.join(', ')}. Quality production, logo branding, and dependable delivery for your next order.`,
      hashtags: ['#MJIC', '#UniformSupplier', '#CorporateFashion', '#CustomApparel'],
    },
    {
      platform: 'TikTok',
      format: '15 sec fast reel',
      caption: `Behind-the-scenes production of ${styles[0]} and other custom apparel. Professional design, embroidery, cutting, and sewing in one place.`,
      hashtags: ['#FactoryStyle', '#CustomGarments', '#BrandWear', '#MJIC'],
    },
  ];
}

async function tryStabilityRender(prompt: string) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        output_format: 'png',
        aspect_ratio: '1:1',
        seed: 42,
      }),
    });

    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (error) {
    console.error('Stability image generation failed:', error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = toText(body.mode, 'render');
    const clientName = toText(body.clientName, 'MJIC client');
    const jacketStyle = toText(body.jacketStyle, 'Corporate jacket');
    const jacketStyles = normalizeStyles(body.jacketStyles || body.jacketStyle);
    const logoUrl = toText(body.logoUrl, '');
    const colorway = toText(body.colorway, 'navy and charcoal premium finish');
    const audience = toText(body.audience, 'corporate team and executive clients');
    const callToAction = toText(body.callToAction, 'Request a custom proposal today');
    const durationSeconds = Number(body.durationSeconds || 15);
    const includeVoiceover = Boolean(body.includeVoiceover);

    const prompt = buildCreativePrompt({ clientName, jacketStyle, logoUrl, colorway, audience, callToAction, jacketStyles });
    const renderUrl = await tryStabilityRender(prompt);

    const storyboard = [
      { id: 'hero', seconds: 0, label: 'Hero product shot', caption: 'Premium studio render of the custom jacket with brand logo styling.' },
      { id: 'detail', seconds: 4, label: 'Detail focus', caption: 'Zoom in on logo embroidery, zipper finish, and premium fabric texture.' },
      { id: 'team', seconds: 8, label: 'Brand showcase', caption: 'Position the jacket in a corporate, team-ready presentation for client proposals.' },
      { id: 'cta', seconds: 12, label: 'Offer close', caption: 'End with the CTA and conversion prompt for the next sales step.' },
    ];

    const activeStyles = jacketStyles.length ? jacketStyles : [jacketStyle];
    const voiceoverScript = buildVoiceoverScript({ clientName, jacketStyle, audience, callToAction, jacketStyles: activeStyles });
    const socialPostingPlan = buildSocialPostingPlan(activeStyles);

    const payload = {
      success: true,
      mode,
      status: renderUrl ? 'ready' : 'queued',
      clientName,
      jacketStyle,
      jacketStyles: activeStyles,
      logoUrl: logoUrl || null,
      colorway,
      audience,
      callToAction,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 15,
      includeVoiceover,
      prompt,
      renderUrl: renderUrl || logoUrl || null,
      storyboard: [
        {
          id: 'opening',
          seconds: 0,
          label: 'Luxury product intro',
          caption: `Opening shot: attractive models wearing premium ${activeStyles.slice(0, 2).join(' and ').toLowerCase()} styles in a high-end lifestyle setup.`,
        },
        {
          id: 'production',
          seconds: 4,
          label: 'Realistic factory flow',
          caption: 'Cutting table action, computer design work, embroidery station, printing station, and seamstresses assembling different jackets and items.',
        },
        {
          id: 'details',
          seconds: 9,
          label: 'Finishing & quality',
          caption: 'Close-up of logos, stitching, fabric quality, zipper details, and final finishing touches.',
        },
        {
          id: 'cta',
          seconds: 12,
          label: 'Trust and conversion',
          caption: 'End with premium branding and a direct customer conversion CTA for custom garment orders.',
        },
      ],
      voiceoverScript,
      socialPostingPlan,
      voiceoverTone: 'confident, polished, sales-focused, and trust-building',
      platformTargets: ['Facebook', 'Instagram Reels', 'TikTok', 'Meta ads'],
      generatedAt: new Date().toISOString(),
      notes: renderUrl
        ? 'Studio render and campaign brief generated using the configured pipeline.'
        : 'No external render API key is configured; the route returned the creative prompt, scene structure, voiceover, and social plan for downstream execution.',
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Media generation failed' },
      { status: 400 },
    );
  }
}
