"use client";

import { useEffect, useState } from "react";
import { MAIN_GOALS, goalProgress, overallProgress, parseDoneSteps, setStepDone, type GoalStatus } from "./main-goals-logic";

const STATUS_LABEL: Record<GoalStatus, string> = { not_started: "Not started", in_progress: "In progress", complete: "Complete" };
const STATUS_CLASS: Record<GoalStatus, string> = {
  not_started: "border-zinc-300 bg-zinc-100 text-zinc-700",
  in_progress: "border-amber-400 bg-amber-100 text-amber-900",
  complete: "border-emerald-500 bg-emerald-100 text-emerald-900",
};

// "Main Goal Reminder": the six core company directives with step checklists, saved server-side per step.
export default function MainGoalsPanel({ token }: { token: string }) {
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/admin/main-goals", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error || "Could not load goal progress.");
        else setDoneSteps(parseDoneSteps(data.doneSteps));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load goal progress.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function toggle(stepId: string, done: boolean) {
    const previous = doneSteps;
    const optimistic = setStepDone(previous, stepId, done);
    if (!optimistic) return;
    setDoneSteps(optimistic);
    setPending(stepId);
    setError("");
    try {
      const res = await fetch("/api/admin/main-goals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, done }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setDoneSteps(parseDoneSteps(data.doneSteps));
    } catch (saveError) {
      setDoneSteps(previous);
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setPending(null);
    }
  }

  if (!token) return null;

  const overall = overallProgress(doneSteps);

  return (
    <section aria-labelledby="main-goals-heading" className="mb-6 rounded-2xl border-2 border-cyan-500/60 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_24px_-6px_rgba(34,211,238,0.45)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="main-goals-heading" className="text-lg font-bold text-cyan-200">🎯 Main Goal Reminder</h2>
          <p className="text-xs text-zinc-400">Six core company directives. Tick each step when it is done; progress saves automatically.</p>
        </div>
        <div className="min-w-48 text-right">
          <p className="text-sm font-semibold text-cyan-100">{overall.done} / {overall.total} steps · {overall.percent}%</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={overall.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Overall goal progress">
            <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${overall.percent}%` }} />
          </div>
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-rose-900/60 p-2 text-sm text-rose-100">{error}</p>}
      {!loaded && <p className="text-sm text-zinc-400">Loading goal progress…</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {MAIN_GOALS.map((goal) => {
          const progress = goalProgress(goal, doneSteps);
          return (
            <article key={goal.id} className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
              <header className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-zinc-50">{goal.number}) {goal.title}</h3>
                  <p className="text-xs text-zinc-400">{goal.summary}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[progress.status]}`}>
                  {progress.status === "complete" ? "✓ " : ""}{STATUS_LABEL[progress.status]}
                </span>
              </header>
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <ol className="space-y-2">
                {goal.steps.map((step, index) => {
                  const checked = doneSteps.includes(step.id);
                  return (
                    <li key={step.id} className="flex gap-2">
                      <input
                        id={step.id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-emerald-500"
                        checked={checked}
                        disabled={!loaded || pending === step.id}
                        onChange={(event) => void toggle(step.id, event.target.checked)}
                      />
                      <label htmlFor={step.id} className="cursor-pointer text-sm">
                        <span className={`font-medium ${checked ? "text-emerald-300 line-through" : "text-zinc-100"}`}>Step {index + 1}: {step.title}</span>
                        <span className="block text-xs text-zinc-400">{step.detail}</span>
                      </label>
                    </li>
                  );
                })}
              </ol>
              {goal.href && (
                <a href={goal.href} className="mt-2 inline-block text-xs font-semibold text-cyan-300 underline">Open {goal.href}</a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
