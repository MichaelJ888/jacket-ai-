// Builds a redacted, allowlisted zip of the UI source for admin export. Dependency-free (zlib + hand-written ZIP writer).
import { deflateRawSync } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './html-export.ts';

export const SOURCE_ROOT_FILES = ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'eslint.config.mjs'] as const;
export const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'public'] as const;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.html', '.htm', '.svg', '.txt', '.xml', '.webmanifest']);
// api: server routes and business prompts stay private. images/videos/templates: binary media, not needed for UI work.
const EXCLUDED_SEGMENTS = new Set(['node_modules', '.git', '.next', '.vercel', 'api', 'images', 'videos', 'templates']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const TOKEN_PATTERNS: Array<[string, RegExp]> = [
  ['openai-key', /sk-[A-Za-z0-9_-]{20,}/g],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/g],
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['meta-token', /EAA[A-Za-z0-9]{40,}/g],
  ['telegram-bot-token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g],
];

export function isSourcePathAllowed(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  if (!segments.length) return false;
  const name = segments[segments.length - 1];
  if (name.startsWith('.env') || /\.test\./.test(name)) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment) || segment.startsWith('.env'))) return false;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  if (segments.length === 1) return (SOURCE_ROOT_FILES as readonly string[]).includes(name);
  return (SOURCE_DIRS as readonly string[]).includes(segments[0]);
}

// Redacts configured secret values (via redactSecrets) and any token-shaped strings. Returns the count for the manifest.
export function redactSource(text: string, env: Record<string, string | undefined>): { text: string; redactions: number } {
  let out = redactSecrets(text, env);
  let redactions = 0;
  for (const [label, pattern] of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions += 1;
      return `[redacted:${label}]`;
    });
  }
  return { text: out, redactions };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = new Uint8Array(deflateRawSync(entry.data));
    const crc = crc32(entry.data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 file names
    local.setUint16(8, 8, true); // deflate
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, compressed);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 8, true);
    header.setUint16(12, dosTime, true);
    header.setUint16(14, dosDate, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, compressed.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);

    offset += 30 + name.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export type CollectedSource = { entries: ZipEntry[]; redactions: number; skipped: string[]; totalBytes: number };

// Walks the allowlisted roots under `root`. Oversized files and anything past the total cap are listed in `skipped`.
export async function collectSourceEntries(root: string, env: Record<string, string | undefined>): Promise<CollectedSource> {
  const candidates: string[] = [];
  for (const file of SOURCE_ROOT_FILES) candidates.push(file);
  const walk = async (dir: string) => {
    let items: import('node:fs').Dirent[];
    try {
      items = await fs.readdir(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const rel = `${dir}/${item.name}`;
      if (item.isDirectory()) await walk(rel);
      else if (item.isFile()) candidates.push(rel);
    }
  };
  for (const dir of SOURCE_DIRS) await walk(dir);

  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let redactions = 0;
  let totalBytes = 0;
  for (const rel of [...new Set(candidates)].sort()) {
    if (!isSourcePathAllowed(rel)) continue;
    const stat = await fs.stat(path.join(root, rel)).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
      skipped.push(rel);
      continue;
    }
    const raw = await fs.readFile(path.join(root, rel)).catch(() => null);
    if (!raw) continue;
    const redacted = redactSource(raw.toString('utf8'), env);
    redactions += redacted.redactions;
    const data = new TextEncoder().encode(redacted.text);
    totalBytes += data.length;
    entries.push({ name: rel, data });
  }
  return { entries, redactions, skipped, totalBytes };
}
