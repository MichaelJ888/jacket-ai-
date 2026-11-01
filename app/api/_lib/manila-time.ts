// Server-side timestamps shown to staff or the public are always Philippine Time. Vercel runs in UTC, so never format without this zone.
export const MANILA_TIME_ZONE = 'Asia/Manila';

export function formatManila(value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  return new Intl.DateTimeFormat('en-PH', { ...options, timeZone: MANILA_TIME_ZONE }).format(new Date(value));
}
