// Verifies that every MJIC ad MP4 exists in the public Supabase Storage bucket `mjic-video-ads`, and uploads any missing one.
// Objects are content-addressed (`<sha256 first 16>.mp4`), the same scheme as upload-videos-to-supabase.mjs, so existing
// content_calendar.media_url values stay valid and byte-identical copies are never uploaded twice.
// Usage:
//   node scripts/sync-video-ads.mjs --verify   # read-only: report present/missing, exit 1 if any are missing
//   node scripts/sync-video-ads.mjs            # upload missing files, then re-verify each public URL
import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'mjic-video-ads';
const SOURCE_DIR = fileURLToPath(new URL('../public/images/MJIC Facebook Video Ads/', import.meta.url));
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;
const REPORTED_NAMES = ['FB VIDEO AD.mp4', 'CGVE video reels.mp4', 'jacket_ad_scene1_revised.mp4', 'jacket_ad_scene2_revised.mp4'];

const verifyOnly = process.argv.includes('--verify');

async function loadEnvFile() {
  try {
    const contents = await readFile(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

// Streams the file through the hash so large videos are never held in memory twice.
async function sha256Of(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function localVideos() {
  const names = readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith('.mp4')).sort();
  const byKey = new Map();
  for (const name of names) {
    const path = join(SOURCE_DIR, name);
    const size = statSync(path).size;
    const key = `${(await sha256Of(path)).slice(0, 16)}.mp4`;
    if (byKey.has(key)) {
      byKey.get(key).names.push(name);
      continue;
    }
    byKey.set(key, { key, names: [name], path, size });
  }
  return [...byKey.values()];
}

async function ensureBucket(supabase) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: FILE_SIZE_LIMIT, allowedMimeTypes: ['video/mp4'] });
  if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
}

async function remoteKeys(supabase) {
  const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(`list ${BUCKET} failed: ${error.message}`);
  return new Set((data || []).map((object) => object.name));
}

async function publicUrlResolves(supabase, key) {
  const url = supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  return { url, ok: response.ok, status: response.status };
}

async function main() {
  await loadEnvFile();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const videos = await localVideos();
  console.log(`Local ad videos: ${videos.length} unique (from ${basename(SOURCE_DIR)}).`);

  if (!verifyOnly) await ensureBucket(supabase);
  let present = await remoteKeys(supabase);

  const missing = videos.filter((video) => !present.has(video.key));
  const oversized = missing.filter((video) => video.size > FILE_SIZE_LIMIT);
  for (const video of oversized) console.error(`SKIP ${video.names[0]}: ${(video.size / 1048576).toFixed(1)} MB exceeds the 50 MB bucket limit.`);

  if (verifyOnly) {
    console.log(`Missing in ${BUCKET}: ${missing.length}`);
  } else {
    for (const video of missing.filter((item) => item.size <= FILE_SIZE_LIMIT)) {
      const blob = await openAsBlob(video.path, { type: 'video/mp4' });
      const { error } = await supabase.storage.from(BUCKET).upload(video.key, blob, { contentType: 'video/mp4', upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) {
        console.error(`FAIL upload ${video.names[0]}: ${error.message}`);
        continue;
      }
      console.log(`UPLOADED ${video.names.join(' = ')} -> ${video.key}`);
    }
    present = await remoteKeys(supabase);
  }

  let unresolved = 0;
  for (const video of videos) {
    const isPresent = present.has(video.key);
    if (!isPresent) unresolved += 1;
    let urlNote = '';
    if (isPresent) {
      const check = await publicUrlResolves(supabase, video.key);
      if (!check.ok) {
        unresolved += 1;
        urlNote = ` (public URL HTTP ${check.status})`;
      }
    }
    const required = video.names.filter((name) => REPORTED_NAMES.includes(name));
    const requiredNote = required.length ? ` [required: ${required.join(', ')}]` : '';
    console.log(`${isPresent ? 'OK     ' : 'MISSING'} ${video.key}  ${video.names.join(' = ')}${requiredNote}${urlNote}`);
  }

  console.log(`Summary: ${videos.length - unresolved}/${videos.length} verified in ${BUCKET}.`);
  if (unresolved) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
