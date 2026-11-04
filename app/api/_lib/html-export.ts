// Public storefront routes that may be exported. Anything not listed here is never fetched.
export const EXPORT_ROUTES = ['/', '/quote', '/status'] as const;

const SECRET_NAME = /SECRET|TOKEN|KEY|PASSWORD|PASS|DSN|CREDENTIAL|PRIVATE/i;
const MIN_SECRET_LENGTH = 8;

// Replaces any configured secret value that appears in the exported HTML, so a leaked env var cannot ship in an export.
export function redactSecrets(html: string, env: Record<string, string | undefined>): string {
  let out = html;
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_SECRET_LENGTH || !SECRET_NAME.test(name)) continue;
    out = out.split(value).join(`[redacted:${name}]`);
  }
  return out;
}

export function exportFileName(now: Date): string {
  return `mjic-site-export-${now.toISOString().slice(0, 10)}.html`;
}
