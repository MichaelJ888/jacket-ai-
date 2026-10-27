import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';
import type { MetaPlatform, MetaPublishingResult } from './meta-publishing';

const COOLDOWN_MS = 6 * 3600_000;

export async function recordMetaPublishingHealth(platform: MetaPlatform, result: MetaPublishingResult) {
  try {
    await recordHealth(platform, result);
  } catch {
    console.error('Meta publishing diagnostic persistence or notification unavailable:', platform, result.code);
  }
}

async function recordHealth(platform: MetaPlatform, result: MetaPublishingResult) {
  const supabase = getSupabaseAdmin();
  const job = `meta-publishing-${platform}`;
  if (result.ok) {
    if (supabase) {
      const { error } = await supabase.from('job_heartbeats').upsert({ job, last_run_at: new Date().toISOString(), last_status: 'ok', details: { key: 'ready' } });
      if (error) console.error('Meta publishing heartbeat failed:', error.message);
    }
    return;
  }
  const key = `${result.code}:${result.reason}`;
  console.warn(`Meta ${platform} publishing paused:`, key);
  let lastAlertAt: string | null = null;
  if (supabase) {
    const { data, error } = await supabase.from('job_heartbeats').select('last_alert_at, details').eq('job', job).maybeSingle();
    if (error) console.error('Meta publishing alert lookup failed:', error.message);
    const previousKey = (data?.details as { key?: string } | null)?.key;
    lastAlertAt = data?.last_alert_at || null;
    if (previousKey === key && lastAlertAt && Date.now() - Date.parse(lastAlertAt) < COOLDOWN_MS) return;
    const logged = await supabase.from('system_logs').insert({ severity: 'warning', context: job, message: result.reason, details: { code: result.code } });
    if (logged.error) console.error('Meta publishing diagnostic log failed:', logged.error.message);
  }
  const sent = await sendTelegramMessage(`<b>Meta ${platform.toUpperCase()} publishing paused</b>\n${escapeTelegramHtml(result.reason)}\nQueued posts stay parked; other platforms can continue.`);
  if (!sent) console.error('Meta publishing CEO alert was not delivered:', platform);
  if (supabase) {
    const { error } = await supabase.from('job_heartbeats').upsert({
      job, last_run_at: new Date().toISOString(), last_status: 'degraded',
      last_alert_at: sent ? new Date().toISOString() : null,
      details: { key, code: result.code, notified: sent },
    });
    if (error) console.error('Meta publishing diagnostic heartbeat failed:', error.message);
  }
}
