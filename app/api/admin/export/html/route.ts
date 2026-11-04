import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { EXPORT_ROUTES, exportFileName, redactSecrets } from '../../../_lib/html-export';

export const dynamic = 'force-dynamic';

const PAGE_TIMEOUT_MS = 10_000;

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Admin-only: returns the HTML source of the allowlisted public pages as one inert, escaped document.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const origin = new URL(request.url).origin;
  const now = new Date();
  const secretEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

  const sections: string[] = [];
  for (const route of EXPORT_ROUTES) {
    let source: string;
    try {
      const response = await fetch(new URL(route, origin), { cache: 'no-store', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
      source = response.ok ? await response.text() : `HTTP ${response.status} — page not exported.`;
    } catch {
      source = 'Fetch failed or timed out — page not exported.';
    }
    source = redactSecrets(source, secretEnv);
    sections.push(`<section id="${escapeHtml(route)}"><h2>${escapeHtml(route)}</h2><pre>${escapeHtml(source)}</pre></section>`);
  }

  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MJIC site HTML source export ${now.toISOString().slice(0, 10)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;margin:24px}pre{white-space:pre-wrap;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px;font-size:12px}</style></head>` +
    `<body><h1>MJIC site HTML source export</h1><p>Generated ${now.toISOString()}. Public pages only; configured secrets are redacted.</p>${sections.join('')}</body></html>`;

  return new NextResponse(document, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(now)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
