import { getSupabaseAdmin } from './integrations';
import { EDITOR_COOKIE, emptySiteDoc, readCookie, SITE_KEY, verifyEditorSession, type SiteDoc } from './site-content-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

// Returns the verified Telegram chat id of the signed-in editor, or null (fails closed when EDITOR_PASSWORD is unset).
export function editorChatFromRequest(request: Request): string | null {
  const token = readCookie(request.headers.get('cookie'), EDITOR_COOKIE);
  return verifyEditorSession(token, process.env.EDITOR_PASSWORD, Date.now());
}

export async function loadSiteDoc(supabase: Supabase): Promise<SiteDoc> {
  const { data } = await supabase.from('site_content').select('value, updated_at').eq('key', SITE_KEY).maybeSingle();
  if (!data) return emptySiteDoc();
  return { ...emptySiteDoc(), ...(data.value as Partial<SiteDoc>), updatedAt: data.updated_at as string };
}

export async function saveSiteDoc(supabase: Supabase, doc: Omit<SiteDoc, 'updatedAt'>) {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('site_content').upsert({ key: SITE_KEY, value: doc, updated_at: updatedAt }, { onConflict: 'key' });
  return { error: error?.message ?? null, updatedAt };
}

export async function readOtpRow(supabase: Supabase, chatId: string) {
  const { data } = await supabase.from('site_content').select('value').eq('key', `editor_otp:${chatId}`).maybeSingle();
  return (data?.value ?? null) as { hash: string; expiresAt: number; attempts: number } | null;
}

export async function writeOtpRow(supabase: Supabase, chatId: string, value: { hash: string; expiresAt: number; attempts: number } | null) {
  const key = `editor_otp:${chatId}`;
  if (value === null) {
    await supabase.from('site_content').delete().eq('key', key);
    return;
  }
  await supabase.from('site_content').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
