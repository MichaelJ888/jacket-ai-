import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { buildZip, collectSourceEntries, listSourceFiles, readSourcePreview } from '../../../_lib/source-zip';

export const dynamic = 'force-dynamic';

function sourceEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

// Admin-only. Default: downloads a redacted zip of the UI source (no API routes, env files, media, or secrets).
// `?list=1` returns the exportable file list as JSON; `?file=<path>` returns one redacted file as JSON for the preview drawer.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get('list') === '1') {
    const files = await listSourceFiles(process.cwd());
    return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const file = url.searchParams.get('file');
  if (file !== null) {
    const preview = await readSourcePreview(process.cwd(), file, sourceEnv());
    if (!preview) return NextResponse.json({ error: 'Not exportable' }, { status: 404 });
    return NextResponse.json({ name: file, ...preview }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const now = new Date();
  const collected = await collectSourceEntries(process.cwd(), sourceEnv());
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
