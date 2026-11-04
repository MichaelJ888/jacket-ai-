import { getSupabaseAdmin } from './integrations';

// Persistent operator settings (table public.system_settings, service-role only).
type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export async function readSetting<T extends Record<string, unknown>>(supabase: Admin, key: string): Promise<T | null> {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return (data.value ?? null) as T | null;
}

export async function writeSetting(supabase: Admin, key: string, value: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.from('system_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return error ? error.message : null;
}
