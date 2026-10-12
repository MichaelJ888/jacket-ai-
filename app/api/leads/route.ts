import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../_lib/rate-limit';
import { recordLead } from '../_lib/integrations';

export async function POST(req: Request) {
  const limited = await rateLimitResponse(req, 'leads', 5, 300);
  if (limited) return limited;
  try {
    const body = await req.json();
    const result = await recordLead({
      name: typeof body.name === 'string' ? body.name.trim() : '',
      company: typeof body.company === 'string' ? body.company.trim() : '',
      contact: typeof body.contact === 'string' ? body.contact.trim() : '',
      message: typeof body.message === 'string' ? body.message.trim() : '',
      source: typeof body.source === 'string' ? body.source : 'website',
      details: body.details && typeof body.details === 'object' ? body.details : undefined,
    });

    if (!result.saved && result.reason !== 'Supabase is not configured') {
      return NextResponse.json({ success: false, error: result.reason }, { status: 502 });
    }

    return NextResponse.json({ success: true, persisted: result.saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid lead request';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
