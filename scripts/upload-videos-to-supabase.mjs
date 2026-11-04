// Uploads the local MJIC ad videos to a public Supabase Storage bucket and queues them as READY rows in content_calendar.
// Idempotent: objects are named by content hash and rows are skipped when their media_url already exists.
// Usage:
//   node scripts/upload-videos-to-supabase.mjs --dry-run   # preview only (no uploads, no inserts)
//   node scripts/upload-videos-to-supabase.mjs             # apply
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'mjic-video-ads';
const videoDirPath = fileURLToPath(new URL('../public/images/MJIC Facebook Video Ads/', import.meta.url));
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;
const PLATFORMS = ['facebook', 'instagram'];
// Same anti-ban policy as app/api/_lib/content-policy.ts: 4 PHT peaks per day, +/-12 min jitter.
const POSTING_SLOTS_PHT = ['09:30', '13:30', '16:00', '20:30'];
const JITTER_MINUTES = 12;
const PHT_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // optional when variables are already exported
}

const dryRun = process.argv.includes('--dry-run');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const cgvConfigured = Boolean(process.env.META_CGV_PAGE_ID);
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const files = readdirSync(videoDirPath).filter((name) => name.toLowerCase().endsWith('.mp4')).sort();
console.log(`Found ${files.length} MP4 files.`);

// Dedupe byte-identical files within each page group (the folder contains copies such as "... (2).mp4").
// A file can belong to both groups: the CGVenezuela reel may be byte-identical to an MJIC ad and must still reach its own page.
const isCgv = (name) => /cgve/i.test(basename(name));
const byGroupHash = new Map();
for (const name of files) {
  const path = join(videoDirPath, name);
  const buffer = readFileSync(path);
  const sha = createHash('sha256').update(buffer).digest('hex');
  const size = statSync(path).size;
  if (size > FILE_SIZE_LIMIT) console.warn(`WARN ${name} is ${(size / 1048576).toFixed(1)} MB, above the 50 MB bucket limit; it will fail.`);
  const group = isCgv(name) ? 'cgv' : 'mjic';
  const key = `${group}:${sha}`;
  if (byGroupHash.has(key)) {
    console.log(`SKIP duplicate of ${byGroupHash.get(key).name}: ${name}`);
    continue;
  }
  byGroupHash.set(key, { name, sha, size, buffer, group });
}
const unique = [...byGroupHash.values()];
console.log(`${unique.length} unique videos after dedupe.`);

// CGVenezuela reel only registers against the cgv page, and only once META_CGV_PAGE_ID is configured.
const mjicVideos = unique.filter((video) => video.group === 'mjic');
const cgvVideos = unique.filter((video) => video.group === 'cgv');
if (cgvVideos.length && !cgvConfigured) console.log(`Holding ${cgvVideos.length} CGVenezuela video(s) until META_CGV_PAGE_ID is set.`);

function captionFor(name) {
  const raw = basename(name, '.mp4').replace(/\s*\(\d+\)$/, '').replace(/[_-]+/g, ' ').trim();
  // Generated export names (for example "0-02-06-<hash>") carry no meaning, so they get the generic caption.
  const base = /^0\s*02\s*06|^[0-9a-f\s]+$/i.test(raw) || raw.length < 3 ? '' : `${raw}. `;
  return `${base}Michael Jeffrey International Corporation: custom uniforms and garments, 20 pcs MOQ, free pre-production samples.`;
}

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: FILE_SIZE_LIMIT, allowedMimeTypes: ['video/mp4'] });
  if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
  console.log(`Bucket ${BUCKET} ready.`);
}

async function uploadVideo(video) {
  const key = `${video.sha.slice(0, 16)}.mp4`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, video.buffer, { contentType: 'video/mp4', upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`upload ${video.name} failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

// Returns the UTC instant of the next PHT midnight after the latest scheduled row (or tomorrow when the queue is empty).
async function scheduleStart() {
  const { data } = await supabase.from('content_calendar').select('scheduled_at').order('scheduled_at', { ascending: false }).limit(1).maybeSingle();
  const floor = data?.scheduled_at ? new Date(data.scheduled_at).getTime() : Date.now() + 3600 * 1000;
  const phtDayStart = Math.floor((floor + PHT_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(phtDayStart + DAY_MS - PHT_OFFSET_MS);
}

// Slot N: day = floor(N / 4), peak = N % 4. The argument is a UTC instant of PHT midnight.
function slotTime(phtMidnightUtc, index) {
  const [hour, minute] = POSTING_SLOTS_PHT[index % POSTING_SLOTS_PHT.length].split(':').map(Number);
  const jitter = Math.round((Math.random() * 2 - 1) * JITTER_MINUTES);
  const day = Math.floor(index / POSTING_SLOTS_PHT.length);
  return new Date(phtMidnightUtc.getTime() + day * DAY_MS + (hour * 60 + minute + jitter) * 60000);
}

// One row per video per platform, each platform keeping its own 4-per-day sequence so the publisher never exceeds its cap.
async function registerRows(videos, pageKey, urlsBySha) {
  if (!videos.length) return 0;
  const start = await scheduleStart();
  let inserted = 0;
  for (const platform of PLATFORMS) {
    let index = 0;
    for (const video of videos) {
      const row = {
        platform,
        page_key: pageKey,
        media_type: 'video',
        caption: captionFor(video.name),
        hashtags: ['#MJIC', '#CustomUniforms'],
        media_url: urlsBySha.get(video.sha),
        scheduled_at: slotTime(start, index).toISOString(),
        status: 'READY',
      };
      index += 1;
      if (dryRun) {
        console.log(`DRY ${pageKey} ${platform} ${row.scheduled_at} ${video.name}`);
      } else {
        const { error } = await supabase.from('content_calendar').insert(row);
        if (error) throw new Error(`insert ${video.name} (${platform}) failed: ${error.message}`);
      }
      inserted += 1;
    }
  }
  return inserted;
}

async function existingMediaUrls() {
  const { data } = await supabase.from('content_calendar').select('media_url').like('media_url', `%/${BUCKET}/%`);
  return new Set((data || []).map((row) => row.media_url));
}

async function main() {
  if (!dryRun) await ensureBucket();
  const alreadyQueued = dryRun ? new Set() : await existingMediaUrls();
  const urlsBySha = new Map();
  const toRegister = [];
  for (const video of [...mjicVideos, ...(cgvConfigured ? cgvVideos : [])]) {
    const url = dryRun
      ? `DRY:${video.sha.slice(0, 16)}.mp4`
      : await uploadVideo(video);
    urlsBySha.set(video.sha, url);
    if (alreadyQueued.has(url)) {
      console.log(`SKIP already queued: ${video.name}`);
      continue;
    }
    toRegister.push(video);
    console.log(`${dryRun ? 'PLAN' : 'UPLOADED'} ${video.name} -> ${url}`);
  }
  const mjicToRegister = toRegister.filter((video) => !isCgv(video.name));
  const cgvToRegister = toRegister.filter((video) => isCgv(video.name));
  const mjicCount = await registerRows(mjicToRegister, 'mjic', urlsBySha);
  const cgvCount = cgvConfigured ? await registerRows(cgvToRegister, 'cgv', urlsBySha) : 0;
  console.log(`${dryRun ? 'Would register' : 'Registered'} ${mjicCount} MJIC row(s) and ${cgvCount} CGVenezuela row(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
