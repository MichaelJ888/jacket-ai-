import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { buildZip, collectSourceEntries } from '../../../_lib/source-zip';

export const dynamic = 'force-dynamic';

// Admin-only: downloads a redacted zip of the UI source (no API routes, env files, media, or secrets).
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const collected = await collectSourceEntries(process.cwd(), env);
  const manifest = [
    `MJIC site source export generated ${now.toISOString()}`,
    `Files: ${collected.entries.length}`,
    `Redactions: ${collected.redactions}`,
    `Excluded (size cap): ${collected.skipped.length ? collected.skipped.join(', ') : 'none'}`,
    'Excluded by policy: app/api, .env*, node_modules, .git, .next, images, videos, tests.',
  ].join('\n');
  const zip = buildZip([{ name: 'EXPORT-MANIFEST.txt', data: new TextEncoder().encode(manifest) }, ...collected.entries], now);
  const stamp = now.toISOString().slice(0, 10);

  return new NextResponse(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="mjic-source-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
