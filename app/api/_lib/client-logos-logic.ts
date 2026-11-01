// Pure helpers for CEO-sent client logos. No imports so they are unit-testable.

export type TrustClient = { slug: string; name: string; aliases: string[] };

// Must stay in sync with the trust roster names in public/index.html.
export const TRUST_CLIENTS: TrustClient[] = [
  { slug: 'panasonic', name: 'Panasonic Manufacturing Philippines', aliases: ['panasonic'] },
  { slug: 'doh', name: 'Department of Health (DOH)', aliases: ['doh', 'department of health'] },
  { slug: 'office-of-the-president', name: 'Office of the President (OP)', aliases: ['op', 'office of the president'] },
  { slug: 'nokia', name: 'Nokia Philippines', aliases: ['nokia'] },
  { slug: 'smart', name: 'Smart Communications', aliases: ['smart'] },
  { slug: 'globe', name: 'Globe Telecom', aliases: ['globe'] },
  { slug: 'rlc', name: 'Robinsons Land Corporation (RLC)', aliases: ['rlc', 'robinsons land'] },
  { slug: 'ue', name: 'University of the East (UE)', aliases: ['ue', 'university of the east'] },
  { slug: 'philippine-power-industries', name: 'Philippine Power Industries Corporation', aliases: ['ppic', 'philippine power', 'philippine power industries'] },
  { slug: 'metro-logistics', name: 'Metro Logistics Group', aliases: ['metro logistics'] },
];

export function normalizeClientRef(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Accepts "logo <client>" or "/logo <client>" as a photo/file caption. Returns null when the caption is not a logo command.
export function parseLogoCaption(caption: string): { ref: string } | null {
  const match = caption.trim().match(/^\/?logo(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return { ref: normalizeClientRef(match[1] || '') };
}

export function matchTrustClient(ref: string): TrustClient | null {
  const wanted = normalizeClientRef(ref);
  if (!wanted) return null;
  return TRUST_CLIENTS.find((client) => [client.slug, client.name, ...client.aliases].some((alias) => normalizeClientRef(alias) === wanted)) ?? null;
}

// Magic-byte check so the stored object is really an image, not just a file that claims to be one.
export function detectImage(buf: Uint8Array): { type: string; ext: string } | null {
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => buf[i] === byte)) return { type: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}
