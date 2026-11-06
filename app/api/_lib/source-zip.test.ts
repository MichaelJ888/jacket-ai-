import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildZip, crc32, isSourcePathAllowed, redactSource } from './source-zip.ts';

// Minimal reader: walks the central directory, inflates each entry, and checks CRC.
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'end of central directory present');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(view.getUint32(p, true), 0x02014b50);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const compressedSize = view.getUint32(p + 20, true);
    const local = localOffset;
    const localNameLen = view.getUint16(local + 26, true);
    const localExtraLen = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLen + localExtraLen;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, size);
    assert.equal(crc32(new Uint8Array(data)), crc, `crc for ${name}`);
    files[name] = Buffer.from(data).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round-trips multiple entries with CRC verified', () => {
  const entries = [
    { name: 'app/page.tsx', data: new TextEncoder().encode('export default function P() { return null; }\n'.repeat(50)) },
    { name: 'package.json', data: new TextEncoder().encode('{"name":"x"}') },
    { name: 'empty.txt', data: new Uint8Array() },
  ];
  const files = readZip(buildZip(entries, new Date(2026, 0, 2, 3, 4, 6)));
  assert.equal(files['app/page.tsx'], Buffer.from(entries[0].data).toString('utf8'));
  assert.equal(files['package.json'], '{"name":"x"}');
  assert.equal(files['empty.txt'], '');
});

test('allowlist includes UI source and excludes secrets, API, and media', () => {
  assert.equal(isSourcePathAllowed('app/page.tsx'), true);
  assert.equal(isSourcePathAllowed('app/admin/page.tsx'), true);
  assert.equal(isSourcePathAllowed('package.json'), true);
  assert.equal(isSourcePathAllowed('public/site-look.js'), true);
  assert.equal(isSourcePathAllowed('.env.local'), false);
  assert.equal(isSourcePathAllowed('app/.env.production'), false);
  assert.equal(isSourcePathAllowed('app/api/chat/route.ts'), false);
  assert.equal(isSourcePathAllowed('app/api/_lib/integrations.ts'), false);
  assert.equal(isSourcePathAllowed('public/images/MJIC Facebook Video Ads/FB VIDEO AD.mp4'), false);
  assert.equal(isSourcePathAllowed('public/images/logo.png'), false);
  assert.equal(isSourcePathAllowed('app/page.test.ts'), false);
  assert.equal(isSourcePathAllowed('node_modules/next/package.json'), false);
  assert.equal(isSourcePathAllowed('scripts/memory.mjs'), false);
});

test('redaction removes configured secrets and token-shaped strings', () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'super-secret-service-role-value' };
  const out = redactSource(`const k = "super-secret-service-role-value"; const a = "AKIAABCDEFGHIJKLMNOP";`, env);
  assert.ok(!out.text.includes('super-secret-service-role-value'));
  assert.ok(!out.text.includes('AKIAABCDEFGHIJKLMNOP'));
  assert.equal(out.redactions, 1);
});

test('preview refuses excluded paths and returns redacted content for allowed files', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { listSourceFiles, readSourcePreview } = await import('./source-zip.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'src-preview-'));
  try {
    await mkdir(path.join(root, 'app', 'api'), { recursive: true });
    await writeFile(path.join(root, 'app', 'page.tsx'), 'const k = "super-secret-service-role-value";');
    await writeFile(path.join(root, 'app', 'api', 'route.ts'), 'export {}');
    await writeFile(path.join(root, '.env.local'), 'X=1');
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'super-secret-service-role-value' };

    const files = (await listSourceFiles(root)).map((f) => f.name);
    assert.deepEqual(files, ['app/page.tsx']);
    assert.equal(await readSourcePreview(root, 'app/api/route.ts', env), null);
    assert.equal(await readSourcePreview(root, '.env.local', env), null);
    assert.equal(await readSourcePreview(root, '../../etc/passwd', env), null);
    const preview = await readSourcePreview(root, 'app/page.tsx', env);
    assert.ok(preview);
    assert.ok(!preview.content.includes('super-secret-service-role-value'));
    assert.equal(preview.redactions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
