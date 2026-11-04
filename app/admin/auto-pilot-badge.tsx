'use client';

import { useEffect, useState } from 'react';

type State = { on: boolean; lastRunAt: string | null; lastStatus: string | null; due: string[]; override: 'on' | 'off' | null; lastStabilizeAt: string | null };

const POLL_MS = 60_000;

// Live "1-push Auto-Pilot / Stabilize" status badge for the /admin quick-launch bar.
// Polls /api/admin/auto-pilot every 60s: pulsing green = ON (heartbeat fresh, no stale cron jobs), amber = OFF.
export default function AutoPilotBadge({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = () =>
      fetch('/api/admin/auto-pilot', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data?.ok)
            setState({
              on: Boolean(data.on),
              lastRunAt: data.lastRunAt ?? null,
              lastStatus: data.lastStatus ?? null,
              due: Array.isArray(data.due) ? data.due : [],
              override: data.override === 'on' || data.override === 'off' ? data.override : null,
              lastStabilizeAt: data.lastStabilizeAt ?? null,
            });
        })
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  if (!token) return null;

  const on = state?.on === true;
  const title = !state
    ? 'Auto-Pilot: checking…'
    : `${on ? 'Auto-Pilot ON' : 'Auto-Pilot OFF'}${state.override ? ` (manual override: ${state.override.toUpperCase()})` : ' (automatic)'}. Last heartbeat ${state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'unknown'}${state.lastStabilizeAt ? `; last Stabilize ${new Date(state.lastStabilizeAt).toLocaleString()}` : ''}${!on && state.due.length ? `; stale jobs: ${state.due.join(', ')}` : ''}. Open Command Center to change.`;

  return (
    <a
      href="/admin/command"
      title={title}
      aria-live="polite"
      className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-center text-base font-semibold transition ${
        !state
          ? 'border-zinc-500/50 bg-zinc-500/10 text-zinc-300'
          : on
            ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/25 hover:shadow-[0_0_16px_-2px_rgba(52,211,153,0.6)]'
            : 'border-amber-400/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/25 hover:shadow-[0_0_16px_-2px_rgba(251,191,36,0.6)]'
      }`}
    >
      <span className="relative flex h-2.5 w-2.5">
        {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${!state ? 'bg-zinc-400' : on ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      {!state ? 'Auto-Pilot …' : on ? 'Auto-Pilot ON' : 'Auto-Pilot OFF'}
    </a>
  );
}
