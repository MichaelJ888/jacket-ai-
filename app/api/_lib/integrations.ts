import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { randomBytes } from 'node:crypto';

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function escapeTelegramHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

// Retries transient network/5xx failures with exponential backoff so a single stalled
// third-party call (Telegram, etc.) doesn't silently drop a customer/staff notification.
export async function fetchWithRetry(input: string, init: RequestInit, maxRetries = 2, baseDelayMs = 300): Promise<Response | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`Request failed with status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  console.error(`fetchWithRetry exhausted retries for ${input}:`, lastError);
  return null;
}

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (error) {
    console.error('Telegram sendMessage failed:', error);
  }
}

// Sends a logo/reference photo to the operations Telegram chat. Accepts either
// a public http(s) URL (sent directly) or a data: URL (uploaded as multipart).
export async function sendTelegramPhoto(imageSource: string, caption: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !imageSource) return;

  try {
    if (/^https?:\/\//i.test(imageSource)) {
      await fetchWithRetry(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: imageSource, caption, parse_mode: 'HTML' }),
      });
      return;
    }

    const match = imageSource.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return;
    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    form.set('photo', new Blob([buffer], { type: mimeType }), `logo.${mimeType.split('/')[1] || 'png'}`);
    await fetchWithRetry(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
  } catch (error) {
    console.error('Telegram sendPhoto failed:', error);
  }
}

export async function recordChatMessage(message: {
  role: 'user' | 'assistant';
  content: string;
  conversationId: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase.from('chat_history').insert({
    conversation_id: message.conversationId,
    role: message.role,
    content: message.content,
  });

  if (error) console.error('Supabase chat history insert failed:', error.message);
}

export async function recordLead(lead: {
  name?: string;
  company?: string;
  contact?: string;
  message?: string;
  source?: string;
  details?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { saved: false, reason: 'Supabase is not configured' };

  const { error } = await supabase.from('leads').insert({
    name: lead.name || null,
    company: lead.company || null,
    contact: lead.contact || null,
    message: lead.message || null,
    source: lead.source || 'website',
    details: lead.details || null,
  });

  if (error) {
    console.error('Supabase lead insert failed:', error.message);
    return { saved: false, reason: error.message };
  }

  return { saved: true };
}

const PAYROLL_TIME_ZONE = 'Asia/Manila';

function getManilaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function manilaBoundaryUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - (8 * 60 * 60 * 1000));
}

export function getPayrollPeriod(now = new Date()) {
  const { year, month, day } = getManilaDateParts(now) as { year: number; month: number; day: number };
  if (day <= 15) {
    return { start: manilaBoundaryUtc(year, month, 1), end: manilaBoundaryUtc(year, month, 16), label: `${month}/01-${month}/15` };
  }
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { start: manilaBoundaryUtc(year, month, 16), end: manilaBoundaryUtc(nextMonth.year, nextMonth.month, 1), label: `${month}/16-${nextMonth.month === 1 && month === 12 ? 12 : month}/end` };
}

export async function getStaffProfile(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.from('staff_profiles').select('*').ilike('staff_name', staffName).maybeSingle();
  return { data, error: error?.message || null };
}

export async function clockInStaff(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data: open, error: lookupError } = await supabase.from('staff_attendance').select('id').ilike('staff_name', staffName).is('time_out', null).maybeSingle();
  if (lookupError) return { data: null, error: lookupError.message };
  if (open) return { data: null, error: `${staffName} already has an open time-in.` };
  const { data, error } = await supabase.from('staff_attendance').insert({ staff_name: staffName, time_in: new Date().toISOString() }).select().single();
  return { data, error: error?.message || null };
}

export async function clockOutStaff(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data: open, error: lookupError } = await supabase.from('staff_attendance').select('id, time_in').ilike('staff_name', staffName).is('time_out', null).order('time_in', { ascending: false }).limit(1).maybeSingle();
  if (lookupError) return { data: null, error: lookupError.message };
  if (!open) return { data: null, error: `${staffName} has no open time-in.` };
  const timeOut = new Date();
  const totalMinutes = Math.max(0, Math.floor((timeOut.getTime() - new Date(open.time_in).getTime()) / 60000));
  const { data: profile } = await getStaffProfile(staffName);
  const totalEarned = Number((totalMinutes * Number(profile?.per_minute_rate || 0)).toFixed(2));
  const { data, error } = await supabase.from('staff_attendance').update({ time_out: timeOut.toISOString(), total_minutes: totalMinutes, total_earned: totalEarned }).eq('id', open.id).select().single();
  return { data, error: error?.message || null };
}

export async function getPayrollSummary(staffName: string) {
  const profileResult = await getStaffProfile(staffName);
  if (!profileResult.data) return { profile: null, totalMinutes: 0, totalEarned: 0, period: getPayrollPeriod(), error: profileResult.error || 'Staff profile not found.' };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { profile: profileResult.data, totalMinutes: 0, totalEarned: 0, period: getPayrollPeriod(), error: 'Supabase is not configured' };
  const period = getPayrollPeriod();
  const { data, error } = await supabase.from('staff_attendance').select('total_minutes, total_earned').ilike('staff_name', staffName).gte('time_in', period.start.toISOString()).lt('time_in', period.end.toISOString()).not('time_out', 'is', null);
  const totalMinutes = (data || []).reduce((sum, row) => sum + Number(row.total_minutes || 0), 0);
  const totalEarned = Number((totalMinutes * Number(profileResult.data.per_minute_rate)).toFixed(2));
  return { profile: profileResult.data, totalMinutes, totalEarned, period, error: error?.message || null };
}

export async function createPurchaseOrder(order: {
  supplierName: string;
  materialType: string;
  quantity: number;
  unitCost: number;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  const poNumber = `PO-${Date.now().toString().slice(-8)}`;
  const totalCost = Number((order.quantity * order.unitCost).toFixed(2));
  const { data, error } = await supabase.from('purchase_orders').insert({
    po_number: poNumber,
    supplier_name: order.supplierName,
    material_type: order.materialType,
    quantity_requested: order.quantity,
    unit_cost: order.unitCost,
    total_cost: totalCost,
    status: 'PENDING_APPROVAL',
  }).select().single();

  return { data, error: error?.message || null };
}

// Rough industry heuristic for planning/approval purposes only — the embroiderer's
// own digitizing software always produces the authoritative stitch count.
const STITCH_DENSITY_PER_SQ_INCH = 1200;

export function estimateStitchCount(widthInches: number, heightInches: number, densityPerSqInch = STITCH_DENSITY_PER_SQ_INCH) {
  const width = Number.isFinite(widthInches) && widthInches > 0 ? widthInches : 0;
  const height = Number.isFinite(heightInches) && heightInches > 0 ? heightInches : 0;
  return Math.round(width * height * densityPerSqInch);
}

export async function createEmbroideryJob(job: {
  projectName?: string;
  clientName?: string;
  companyName?: string;
  contact?: string;
  garmentStyle?: string;
  quantity?: number;
  placement: string;
  widthInches?: number;
  heightInches?: number;
  stitchCount?: number;
  threadColors?: Array<{ name: string; code?: string }>;
  logoImage?: string;
  embroidererName?: string;
  embroidererContact?: string;
  notes?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  const stitchCount = job.stitchCount ?? estimateStitchCount(Number(job.widthInches || 0), Number(job.heightInches || 0));
  const { data, error } = await supabase.from('embroidery_jobs').insert({
    project_name: job.projectName || null,
    client_name: job.clientName || null,
    company_name: job.companyName || null,
    contact: job.contact || null,
    garment_style: job.garmentStyle || null,
    quantity: job.quantity || null,
    placement: job.placement,
    width_inches: job.widthInches || null,
    height_inches: job.heightInches || null,
    stitch_count: stitchCount,
    thread_colors: job.threadColors || [],
    logo_image: job.logoImage || null,
    embroiderer_name: job.embroidererName || null,
    embroiderer_contact: job.embroidererContact || null,
    notes: job.notes || null,
    status: 'DISPATCHED',
    dispatched_at: new Date().toISOString(),
  }).select().single();

  return { data, error: error?.message || null };
}

export async function createDigitizeJob(job: {
  embroideryJobId?: string;
  sourceImage: string;
  placement?: string;
  widthInches?: number;
  heightInches?: number;
  status: 'COMPLETED' | 'PENDING_MANUAL_DIGITIZING' | 'FAILED';
  provider?: string;
  dstFileUrl?: string;
  dstFileBase64?: string;
  stitchCount?: number;
  notes?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  const { data, error } = await supabase.from('digitize_jobs').insert({
    embroidery_job_id: job.embroideryJobId || null,
    source_image: job.sourceImage,
    placement: job.placement || null,
    width_inches: job.widthInches || null,
    height_inches: job.heightInches || null,
    status: job.status,
    provider: job.provider || null,
    dst_file_url: job.dstFileUrl || null,
    dst_file_base64: job.dstFileBase64 || null,
    stitch_count: job.stitchCount || null,
    notes: job.notes || null,
  }).select().single();

  return { data, error: error?.message || null };
}

// ---- Daily staff task reminders (cron-driven Telegram automation) ----

function getManilaHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: PAYROLL_TIME_ZONE, hour: '2-digit', hour12: false }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || '0') % 24;
}

export function isManilaDaytime(startHour = 8, endHour = 20, date = new Date()) {
  const hour = getManilaHour(date);
  return hour >= startHour && hour < endHour;
}

// A short-lived, single-use code lets a staff member privately message the bot to
// bind their personal Telegram chat to their staff profile, without exposing chat IDs.
export async function generateStaffLinkCode(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { code: null, error: 'Supabase is not configured' };
  const code = randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await supabase.from('staff_profiles').update({ link_code: code, link_code_expires_at: expiresAt }).ilike('staff_name', staffName);
  if (error) return { code: null, error: error.message };
  return { code, error: null };
}

export async function linkStaffTelegramChat(code: string, chatId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { staffName: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.from('staff_profiles').select('staff_name, link_code_expires_at').eq('link_code', code).maybeSingle();
  if (error) return { staffName: null, error: error.message };
  if (!data) return { staffName: null, error: null };
  if (!data.link_code_expires_at || new Date(data.link_code_expires_at).getTime() < Date.now()) return { staffName: null, error: 'Code expired' };
  const { error: updateError } = await supabase.from('staff_profiles').update({ telegram_chat_id: chatId, link_code: null, link_code_expires_at: null }).eq('staff_name', data.staff_name);
  if (updateError) return { staffName: null, error: updateError.message };
  return { staffName: data.staff_name as string, error: null };
}

export async function getStaffByChatId(chatId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data } = await supabase.from('staff_profiles').select('*').eq('telegram_chat_id', chatId).maybeSingle();
  return data;
}

export async function createStaffTask(task: {
  staffName: string;
  taskText: string;
  priority?: 'normal' | 'urgent' | 'emergency';
  dueAt?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.from('staff_tasks').insert({
    staff_name: task.staffName,
    task_text: task.taskText,
    priority: task.priority || 'normal',
    due_at: task.dueAt || null,
  }).select().single();
  return { data, error: error?.message || null };
}

export async function listMorningTasks(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase.from('staff_tasks').select('*').ilike('staff_name', staffName).eq('status', 'pending').order('created_at', { ascending: true });
  return data || [];
}

export async function listDueWatchTasks() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const { data } = await supabase.from('staff_tasks').select('*').eq('status', 'pending').in('priority', ['urgent', 'emergency']).lt('reminder_count', 6).or(`last_reminded_at.is.null,last_reminded_at.lt.${cutoff}`);
  return data || [];
}

export async function markTaskReminded(taskId: string, currentReminderCount: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  await supabase.from('staff_tasks').update({ last_reminded_at: new Date().toISOString(), reminder_count: currentReminderCount + 1 }).eq('id', taskId);
}

export async function completeLatestTaskForStaff(staffName: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data: task, error: fetchError } = await supabase.from('staff_tasks').select('*').ilike('staff_name', staffName).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (fetchError) return { data: null, error: fetchError.message };
  if (!task) return { data: null, error: 'No pending task found.' };
  const { data, error } = await supabase.from('staff_tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id).select().single();
  return { data, error: error?.message || null };
}

// Sends a message to a specific Telegram chat (e.g. a linked staff member's DM),
// distinct from sendTelegramMessage/sendTelegramPhoto which broadcast to the ops chat.
export async function sendTelegramDirectMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('Telegram direct message failed:', error);
  }
}

const bossVoiceModel = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Rewrites a plain instruction into the boss's natural, personal Taglish texting
// voice — never mentions AI/automation, and never signs off like a formal notice.
const BOSS_VOICE_PROMPT = `You are drafting a short Telegram text message from a small Philippine garment business owner ("Boss") directly to one trusted staff member.
Tone: warm, direct, casual Filipino-English (Taglish), natural use of "po/opo" where a real boss would, like a real personal text — not a formal announcement.
Rules:
- Keep it short (1-4 sentences), like a real chat message.
- Never mention AI, automation, bots, or systems, and never say this message was generated.
- Do not sign off with a name, title, or closing line — end naturally like a text message.
- Do not use corporate phrases like "Please be advised" or "This is a reminder that".
- Just naturally relay the instruction as if the boss personally typed it.
Rewrite the following instruction into that voice. Output only the final message, nothing else.`;

export async function composeBossStyleMessage(rawText: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return rawText;
  try {
    const result = await generateText({ model: bossVoiceModel('gemini-3.6-flash'), system: BOSS_VOICE_PROMPT, prompt: rawText });
    return result.text.trim() || rawText;
  } catch (error) {
    console.error('Boss-style message composition failed, using raw text:', error);
    return rawText;
  }
}
