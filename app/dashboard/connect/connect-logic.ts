export type OAuthMessage = { status: 'connected'; pages: number; failed: number; skipped: number; limit: boolean } | { status: 'error'; reason: string };

// Only accept the callback's postMessage from our own origin.
export function parseOAuthMessage(data: unknown, origin: string, expectedOrigin: string): OAuthMessage | null {
  if (origin !== expectedOrigin || !data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'mjic-meta-oauth') return null;
  if (message.meta === 'connected') return { status: 'connected', pages: Number(message.pages) || 0, failed: Number(message.failed) || 0, skipped: Number(message.skipped) || 0, limit: message.limit === '1' || message.limit === 1 };
  return { status: 'error', reason: typeof message.reason === 'string' && message.reason ? message.reason : 'Connection failed' };
}


// Shown when the Facebook window closes without the callback reporting back (usually Facebook itself refused the login).
export const CLOSED_WITHOUT_RESULT_TEXT = 'The Facebook window closed before the connection finished. If Facebook showed "App not available" or an error, your account is not added as a Tester yet - use the request-access option below. Otherwise press Connect again.';

export type WizardPage = { page_id: string; webhook_subscribed: boolean };
export type WizardStep = 1 | 2 | 3 | 4;

// 1 log in, 2 choose Pages (inside Facebook dialog), 3 webhook check, 4 done.
export function wizardStep(pages: WizardPage[], connecting: boolean, healthy: Record<string, boolean>): WizardStep {
  if (connecting) return 2;
  if (!pages.length) return 1;
  return pages.every((page) => healthy[page.page_id]) ? 4 : 3;
}

export function describeError(reason: string) {
  const text = reason.toLowerCase();
  if (text.includes('denied') || text.includes('cancel')) return 'Permission was not granted. Please accept all requested permissions so messaging can work.';
  if (text.includes('expired') || text.includes('invalid or expired')) return 'The login session expired. Please press Connect again.';
  if (text.includes('no facebook pages')) return 'No Page was selected. In the Facebook dialog, choose at least one Page.';
  if (text.includes('not authorized') || text.includes('developer') || text.includes('tester')) return 'This app is still in Development Mode, so only Testers can connect. Ask the owner to add you as a Tester.';
  return reason;
}
