import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { runSwarm, clampAgents, CEO_SWARM_MAX_AGENTS, type SwarmState } from '../_lib/swarm';
import { createPoolRunner } from '../_lib/swarm-runner';

export const maxDuration = 60;

// POST { goal, context?, maxAgents?, verify?, concurrency?, state? }
// Returns { status, state, report }. If status is "partial" (time budget hit), POST again with the returned `state` to resume;
// finished agents are never re-run. Admin-token gated; fails closed.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const goal = typeof body?.goal === 'string' ? body.goal.trim().slice(0, 4000) : '';
  if (!goal && !body?.state) return NextResponse.json({ error: 'goal is required' }, { status: 400 });

  const state: SwarmState | undefined = body?.state && typeof body.state === 'object' ? body.state : undefined;
  if (state && (typeof state.goal !== 'string' || typeof state.results !== 'object' || typeof state.agentsUsed !== 'number')) {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 });
  }

  try {
    const result = await runSwarm({
      goal: goal || state!.goal,
      context: typeof body?.context === 'string' ? body.context : undefined,
      runner: createPoolRunner(),
      maxAgents: clampAgents(body?.maxAgents, CEO_SWARM_MAX_AGENTS),
      concurrency: typeof body?.concurrency === 'number' ? body.concurrency : 5,
      verify: body?.verify !== false,
      deadlineMs: 22000,
      state,
    });
    return NextResponse.json({ status: result.status, report: result.state.report, agentsUsed: result.state.agentsUsed, state: result.state });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'swarm failed' }, { status: 502 });
  }
}
