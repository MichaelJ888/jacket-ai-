import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { MJIC_SYSTEM_PROMPT } from '../../_lib/mjic-prompt';
import { voiceRules } from '../../_lib/voice-logic';

export const dynamic = 'force-dynamic';

// Admin-only: paste this into the Retell agent's general prompt so phone answers use the same exact prices as chat.
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const base = new URL(req.url).origin;
  return NextResponse.json({
    general_prompt: `${MJIC_SYSTEM_PROMPT}\n\n${voiceRules()}`,
    custom_functions_url: `${base}/api/voice-call/tools`,
    webhook_url: `${base}/api/voice-call`,
    functions: ['check_order_status(order_number)', 'create_lead(name, request, contact?)', 'request_human_callback(reason)'],
  });
}
