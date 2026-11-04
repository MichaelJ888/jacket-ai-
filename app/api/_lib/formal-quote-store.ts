import { randomBytes } from 'node:crypto';
import type { FormalQuote } from './formal-quote.ts';
import { getSupabaseAdmin } from './integrations';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export type SaveFormalQuoteInput = {
  customerName: string;
  customerContact: string | null;
  productName: string | null;
  quote: FormalQuote;
  inputs: Record<string, unknown>;
  channel: 'formal-quote' | 'quote-web';
};

export type SavedFormalQuote = {
  id: string;
  accessToken: string;
  clientToken: string;
  quoteNumber: string;
  createdAt: string;
};

const TOKEN_RE = /^[a-f0-9]{32}$/;
export const isFormalToken = (value: string) => TOKEN_RE.test(value);

// Saves a formal quote: CRM contact first (best effort), then a sequential MJIC-YYYY-NNNN number and a client token.
export async function saveFormalQuote(supabase: Supabase, input: SaveFormalQuoteInput): Promise<SavedFormalQuote> {
  const { customerName, customerContact, quote } = input;
  const isEmail = customerContact?.includes('@') ?? false;
  const externalId = (customerContact || customerName).toLowerCase();

  let crmContactId: string | null = null;
  const { data: crm, error: crmError } = await supabase
    .from('crm_contacts')
    .upsert(
      {
        channel: input.channel,
        external_id: externalId,
        name: customerName,
        phone: customerContact && !isEmail ? customerContact : null,
        email: isEmail ? customerContact : null,
        stage: 'quoted',
        notes: `Formal quote: total PHP ${quote.total}, deposit PHP ${quote.deposit}`,
      },
      { onConflict: 'channel,external_id' },
    )
    .select('id')
    .maybeSingle();
  if (crmError) console.error('Formal quote CRM upsert failed:', crmError.message);
  else crmContactId = crm?.id ?? null;

  // Returning client: reuse the token from the most recent quote for the same contact.
  let clientToken: string | null = null;
  if (crmContactId) {
    const { data: prior } = await supabase
      .from('formal_quotes')
      .select('client_token')
      .eq('crm_contact_id', crmContactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    clientToken = prior?.client_token ?? null;
  }
  clientToken ??= randomBytes(16).toString('hex');

  const { data: numberData, error: numberError } = await supabase.rpc('next_formal_quote_number');
  if (numberError || typeof numberData !== 'string') throw new Error(numberError?.message || 'Quote number unavailable');

  const { data, error } = await supabase
    .from('formal_quotes')
    .insert({
      access_token: randomBytes(16).toString('hex'),
      client_token: clientToken,
      quote_number: numberData,
      crm_contact_id: crmContactId,
      customer_name: customerName,
      customer_contact: customerContact,
      product_name: input.productName,
      product_class: quote.productClass,
      quantity: quote.quantity,
      inputs: input.inputs,
      breakdown: quote,
      discount: quote.discount,
      total: quote.total,
      deposit: quote.deposit,
    })
    .select('id, access_token, client_token, quote_number, created_at')
    .single();
  if (error || !data) throw new Error(error?.message || 'Save failed');

  return {
    id: data.id,
    accessToken: data.access_token,
    clientToken: data.client_token,
    quoteNumber: data.quote_number,
    createdAt: data.created_at,
  };
}

const QUOTE_COLUMNS = 'quote_number, access_token, customer_name, product_name, product_class, quantity, breakdown, total, deposit, created_at';

export async function getQuoteByAccessToken(supabase: Supabase, token: string) {
  const { data, error } = await supabase.from('formal_quotes').select(QUOTE_COLUMNS).eq('access_token', token).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Every quote issued to one client, newest first. Keyed by the unguessable client token.
export async function listQuotesByClientToken(supabase: Supabase, clientToken: string) {
  const { data, error } = await supabase
    .from('formal_quotes')
    .select(QUOTE_COLUMNS)
    .eq('client_token', clientToken)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
