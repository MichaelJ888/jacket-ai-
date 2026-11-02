import { getSupabaseAdmin, reportCriticalError } from './integrations.ts';

export type ClientActivityEntry = {
  entityType: 'lead' | 'order' | 'crm_contact';
  entityId: string;
  action: string;
  actor?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

// Append-only audit trail. A logging failure is reported but never blocks the business action.
export async function logClientActivity(entry: ClientActivityEntry) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.from('client_activity_logs').insert({
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    actor: entry.actor || 'system',
    before_state: entry.before ?? null,
    after_state: entry.after ?? null,
  });
  if (error) await reportCriticalError('client-activity', error);
}

export async function countClientActivitySince(sinceIso: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const { count } = await supabase.from('client_activity_logs').select('id', { count: 'exact', head: true }).gte('created_at', sinceIso);
  return count || 0;
}
