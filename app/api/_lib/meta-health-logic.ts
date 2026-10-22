const REQUIRED_FIELDS = ['messages', 'messaging_postbacks', 'feed'];

export type HealthCheck = { id: string; label: string; ok: boolean; hint?: string };

export type HealthInputs = {
  appId: string;
  tokenValid: boolean;
  tokenError?: string;
  tokenExpiresAt?: number;
  tokenAppId?: string;
  subscribedApps?: Array<{ id?: string; subscribed_fields?: string[] }>;
  igUserId?: string | null;
  now?: number;
};

export function evaluateHealth(input: HealthInputs): HealthCheck[] {
  const now = input.now ?? Date.now();
  const expiresOk = !input.tokenExpiresAt || input.tokenExpiresAt * 1000 > now;
  const mine = (input.subscribedApps || []).find((app) => app.id === input.appId);
  const missing = REQUIRED_FIELDS.filter((field) => !mine?.subscribed_fields?.includes(field));
  return [
    {
      id: 'token',
      label: 'Page token is valid',
      ok: input.tokenValid && expiresOk && (!input.tokenAppId || input.tokenAppId === input.appId),
      hint: input.tokenError || 'Token is invalid or expired. Click "Connect Facebook / Instagram" again to refresh it.',
    },
    {
      id: 'webhook',
      label: 'Webhook is subscribed',
      ok: Boolean(mine),
      hint: 'Our app is not subscribed to this Page. Press "Re-subscribe".',
    },
    {
      id: 'fields',
      label: 'Messages, postbacks and comments are enabled',
      ok: Boolean(mine) && missing.length === 0,
      hint: mine ? `Missing webhook fields: ${missing.join(', ')}. Press "Re-subscribe".` : 'Subscribe the webhook first.',
    },
    {
      id: 'instagram',
      label: 'Instagram account linked (optional)',
      ok: Boolean(input.igUserId),
      hint: 'No Instagram Business account is linked to this Page. Link it in Page settings, then re-connect.',
    },
  ];
}
