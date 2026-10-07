import { sendChannelMessage } from './channels';
import { logMessage, updateContact, type Channel } from './crm';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';

export type Mode = 'live' | 'shadow';

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return fallback;
  const { data } = await supabase.from('ceo_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}

export async function setSetting(key: string, value: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('ceo_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  return { error: error?.message || null };
}

// Shadow mode: the AI drafts replies but only the CEO sees them (dry-run before a vacation).
export async function isShadowMode() {
  return (await getSetting('shadow_mode', process.env.SHADOW_MODE === '1' ? 'on' : 'off')) === 'on';
}

export async function isVacationMode() {
  return (await getSetting('vacation_mode', 'off')) === 'on';
}

// Peso amount above which the AI must ask the CEO instead of deciding alone.
export async function autonomyLimitPhp() {
  const raw = Number(await getSetting('autonomy_limit_php', '5000'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 5000;
}

export type ApprovalAction =
  | { type: 'resume_ai'; contactId: string }
  | { type: 'send_reply'; contactId: string; channel: Channel; externalId: string; text: string }
  | { type: 'note' };

export async function createApproval(input: { kind: string; summary: string; action: ApprovalAction; amount?: number }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { id: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('approvals')
    .insert({ kind: input.kind, summary: input.summary.slice(0, 1500), payload: input.action, amount: input.amount ?? null })
    .select('id')
    .single();
  if (error || !data) return { id: null, error: error?.message || 'insert failed' };
  await sendTelegramMessage(`<b>APPROVAL NEEDED (${escapeTelegramHtml(input.kind)})</b>\n${escapeTelegramHtml(input.summary.slice(0, 900))}`, {
    inline_keyboard: [[{ text: 'Approve', callback_data: `appr:yes:${data.id}` }, { text: 'Reject', callback_data: `appr:no:${data.id}` }]],
  });
  return { id: data.id as string, error: null };
}

// Atomically claims a PENDING approval, then runs its action. Returns a short result for Telegram.
export async function resolveApproval(id: string, approve: boolean): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Database not configured.';
  const { data } = await supabase
    .from('approvals')
    .update({ status: approve ? 'APPROVED' : 'REJECTED', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('kind, payload')
    .maybeSingle();
  if (!data) return 'Already handled or not found.';
  if (!approve) return `Rejected (${data.kind}).`;

  const action = data.payload as ApprovalAction;
  if (action.type === 'resume_ai') {
    await updateContact(action.contactId, { ai_paused: false });
    return 'Approved. AI resumed on that contact.';
  }
  if (action.type === 'send_reply') {
    const result = await sendChannelMessage(action.channel, action.externalId, action.text);
    await logMessage({ contactId: action.contactId, channel: action.channel, direction: 'out', sender: 'human', content: action.text, status: result.ok ? 'sent' : 'failed' });
    return result.ok ? 'Approved and sent to the customer.' : `Approved, but sending failed: ${result.reason}`;
  }
  return `Approved (${data.kind}).`;
}

export async function expireOldApprovals(hours = 48) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const { data } = await supabase.from('approvals').update({ status: 'EXPIRED', decided_at: new Date().toISOString() }).eq('status', 'PENDING').lt('created_at', new Date(Date.now() - hours * 3600 * 1000).toISOString()).select('id');
  return data?.length || 0;
}
