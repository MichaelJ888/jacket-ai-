import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export type SiteTheme = { primary: string; secondary: string; background: string };
export type SitePosition = { x: number; y: number };
export type SiteDoc = {
  theme: SiteTheme;
  texts: Record<string, string>;
  images: Record<string, string>;
  catalogOrder: string[];
  sectionOrder: string[];
  positions: Record<string, SitePosition>;
  updatedAt: string | null;
};

export const SITE_KEY = 'site';
export const EDITOR_COOKIE = 'mjic_editor';
export const EDITOR_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const ANNE_MANALO_CHAT_ID = '7329264426';

const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_URL = /^(https:\/\/|\/(?!\/))[^\s"'<>()]+$/;
const MAX_TEXTS = 400;
const MAX_IMAGES = 200;
const MAX_KEY = 300;
const MAX_TEXT = 2000;
const MAX_URL = 2000;
const MAX_OFFSET = 2000;

export const DEFAULT_THEME: SiteTheme = { primary: '#0B1E3D', secondary: '#B8912F', background: '#FFFFFF' };

export function emptySiteDoc(): SiteDoc {
  return { theme: { ...DEFAULT_THEME }, texts: {}, images: {}, catalogOrder: [], sectionOrder: [], positions: {}, updatedAt: null };
}

type SanitizeResult = { ok: true; doc: SiteDoc } | { ok: false; error: string };

// Strict allowlist: the public page applies this document as-is, so every field is validated here.
export function sanitizeSiteDoc(input: unknown): SanitizeResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid document.' };
  const raw = input as Record<string, unknown>;
  const themeRaw = (raw.theme && typeof raw.theme === 'object' ? raw.theme : {}) as Record<string, unknown>;
  const theme = { ...DEFAULT_THEME };
  for (const field of ['primary', 'secondary', 'background'] as const) {
    const value = themeRaw[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !HEX.test(value)) return { ok: false, error: `Theme ${field} must be a #RRGGBB color.` };
    theme[field] = value.toUpperCase();
  }

  const texts = pickStrings(raw.texts, MAX_TEXTS, MAX_TEXT, 'text');
  if (!texts.ok) return texts;
  const images = pickStrings(raw.images, MAX_IMAGES, MAX_URL, 'image');
  if (!images.ok) return images;
  for (const url of Object.values(images.value)) {
    if (!IMAGE_URL.test(url)) return { ok: false, error: 'Image URLs must be https:// or start with /.' };
  }

  const catalog = pickKeyList(raw.catalogOrder, 'catalog order');
  if (!catalog.ok) return catalog;
  const sections = pickKeyList(raw.sectionOrder, 'section order');
  if (!sections.ok) return sections;
  const positions = pickPositions(raw.positions);
  if (!positions.ok) return positions;

  return {
    ok: true,
    doc: {
      theme,
      texts: texts.value,
      images: images.value,
      catalogOrder: catalog.value,
      sectionOrder: sections.value,
      positions: positions.value,
      updatedAt: null,
    },
  };
}

function pickPositions(value: unknown): { ok: true; value: Record<string, SitePosition> } | { ok: false; error: string } {
  const out: Record<string, SitePosition> = {};
  if (value === undefined || value === null) return { ok: true, value: out };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Invalid position map.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TEXTS + MAX_IMAGES) return { ok: false, error: 'Too many position edits.' };
  for (const [key, item] of entries) {
    if (key.length > MAX_KEY || key === '__proto__') return { ok: false, error: 'Invalid position key.' };
    const pos = item as Record<string, unknown> | null;
    if (!pos || typeof pos !== 'object') return { ok: false, error: 'Invalid position value.' };
    const { x, y } = pos;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'Invalid position value.' };
    }
    if (Math.abs(x) > MAX_OFFSET || Math.abs(y) > MAX_OFFSET) return { ok: false, error: 'Position offset out of range.' };
    out[key] = { x: Math.round(x), y: Math.round(y) };
  }
  return { ok: true, value: out };
}

function pickKeyList(value: unknown, label: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > 200 || value.some((id) => typeof id !== 'string' || id.length > MAX_KEY)) {
    return { ok: false, error: `Invalid ${label}.` };
  }
  return { ok: true, value: value as string[] };
}

function pickStrings(value: unknown, maxEntries: number, maxLength: number, label: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  if (value === undefined || value === null) return { ok: true, value: out };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `Invalid ${label} map.` };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxEntries) return { ok: false, error: `Too many ${label} edits.` };
  for (const [key, item] of entries) {
    if (key.length > MAX_KEY) return { ok: false, error: `${label} key too long.` };
    if (typeof item !== 'string' || item.length > maxLength) return { ok: false, error: `${label} value too long or invalid.` };
    out[key] = item;
  }
  return { ok: true, value: out };
}

export function isEditorChatAllowed(chatId: string, ceoUserId: string | undefined) {
  const allowed = [ceoUserId, ANNE_MANALO_CHAT_ID].filter((id): id is string => Boolean(id && id.trim())).map((id) => id.trim());
  return allowed.includes(chatId.trim());
}

// Codes go to the CEO chat, which has already started the bot; a bot cannot DM users who never messaged it (403).
export function editorDeliveryChat(chatId: string, ceoUserId: string | undefined) {
  return ceoUserId?.trim() || chatId.trim();
}

function safeEqual(a: string, b: string) {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

export function checkEditorPassword(presented: string, expected: string | undefined) {
  if (!expected) return false;
  return safeEqual(presented, expected);
}

// Session and OTP secrets are derived from EDITOR_PASSWORD so no extra secret needs to be configured.
function editorKey(password: string) {
  return createHash('sha256').update(`mjic-editor:${password}`).digest('hex');
}

export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(code: string, chatId: string, password: string) {
  return createHmac('sha256', editorKey(password)).update(`${chatId}:${code}`).digest('hex');
}

export function signEditorSession(chatId: string, expiresAt: number, password: string) {
  const payload = `${chatId}.${expiresAt}`;
  const signature = createHmac('sha256', editorKey(password)).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifyEditorSession(token: string | undefined, password: string | undefined, now: number): string | null {
  if (!token || !password) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [chatId, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;
  const expected = createHmac('sha256', editorKey(password)).update(`${chatId}.${expiresRaw}`).digest('hex');
  return safeEqual(signature, expected) ? chatId : null;
}

export function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
