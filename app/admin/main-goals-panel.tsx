"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_GOALS,
  MAX_STEPS_PER_GOAL,
  MAX_TITLE_LENGTH,
  addGoal,
  addStep,
  deleteGoal,
  deleteStep,
  goalProgress,
  overallProgress,
  setStepTitle,
  toggleStep,
  type GoalStatus,
  type MainGoal,
} from "./main-goals-logic";

const STATUS_LABEL: Record<GoalStatus, string> = { not_started: "Not started", in_progress: "In progress", complete: "Complete" };
const STATUS_CLASS: Record<GoalStatus, string> = {
  not_started: "border-zinc-600 bg-zinc-800 text-zinc-300",
  in_progress: "border-amber-400 bg-amber-900/60 text-amber-200",
  complete: "border-emerald-500 bg-emerald-900/60 text-emerald-200",
};
const INPUT_CLASS = "min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-400 focus:outline-none";
const BUTTON_CLASS = "rounded border border-cyan-500/60 px-2 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-40";

type SaveState = "idle" | "saving" | "saved" | "error";

// "MJIC Main Goal Directives": editable goals and steps, with checked state saved to Supabase.
export default function MainGoalsPanel({ token }: { token: string }) {
  const [goals, setGoals] = useState<MainGoal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [goalNotice, setGoalNotice] = useState("");
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});
  const dirtyRef = useRef(false);
  const saveSeq = useRef(0);

  // Editing stays locked until the stored list loads, so a failed load can never overwrite it.
  const ready = loaded && !loadError;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/admin/main-goals", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(data.error || "Could not load goals.");
        else setGoals(Array.isArray(data.goals) ? data.goals : []);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load goals.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = useCallback(
    async (snapshot: MainGoal[]) => {
      const seq = ++saveSeq.current;
      dirtyRef.current = false;
      setSaveState("saving");
      setSaveError("");
      try {
        const res = await fetch("/api/admin/main-goals", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ goals: snapshot }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Save failed");
        if (seq === saveSeq.current && !dirtyRef.current) setSaveState("saved");
      } catch (error) {
        if (seq !== saveSeq.current) return;
        dirtyRef.current = true;
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Save failed");
      }
    },
    [token],
  );

  // Debounced autosave: each change restarts the timer, so typing sends one request.
  useEffect(() => {
    if (!ready || !dirtyRef.current) return;
    const timer = window.setTimeout(() => void save(goals), 500);
    return () => window.clearTimeout(timer);
  }, [goals, ready, save]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || saveState === "saving") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  function mutate(update: (current: MainGoal[]) => MainGoal[]) {
    dirtyRef.current = true;
    setGoals(update);
  }

  async function handleAddGoal(event: FormEvent) {
    event.preventDefault();
    const title = newGoalTitle.trim();
    if (!title || generating) return;
    if (goals.length >= MAX_GOALS) {
      setGoalNotice(`At most ${MAX_GOALS} goals.`);
      return;
    }
    setGoalNotice("");
    setGenerating(true);
    let steps: string[] = [];
    try {
      const res = await fetch("/api/admin/main-goals/suggest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.steps)) steps = data.steps;
      else setGoalNotice(`${data.error || "AI step generation failed."} The goal was added without steps.`);
    } catch {
      setGoalNotice("AI step generation failed. The goal was added without steps.");
    } finally {
      setGenerating(false);
    }
    mutate((current) => addGoal(current, title, steps));
    setNewGoalTitle("");
  }

  function handleAddStep(goalId: string) {
    const title = (stepDrafts[goalId] ?? "").trim();
    if (!title) return;
    mutate((current) => addStep(current, goalId, title));
    setStepDrafts((drafts) => ({ ...drafts, [goalId]: "" }));
  }

  if (!token) return null;

  const overall = overallProgress(goals);

  return (
    <section aria-labelledby="main-goals-heading" className="mb-6 rounded-2xl border-2 border-cyan-500/60 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_24px_-6px_rgba(34,211,238,0.45)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="main-goals-heading" className="text-lg font-bold text-cyan-200">🎯 MJIC Main Goal Directives</h2>
          <p className="text-xs text-zinc-400">Tick each step when it is done. Goals and steps can be edited, and changes save automatically.</p>
        </div>
        <div className="min-w-56 text-right">
          <p className="text-sm font-semibold text-cyan-100">Company completion: {overall.done} / {overall.total} steps · {overall.percent}%</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={overall.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Overall company completion">
            <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${overall.percent}%` }} />
          </div>
          <p className="mt-1 text-xs" aria-live="polite">
            {!ready && !loadError && <span className="text-zinc-400">Loading goals…</span>}
            {saveState === "saving" && <span className="text-zinc-400">Saving…</span>}
            {saveState === "saved" && <span className="text-emerald-300">✓ Saved</span>}
            {saveState === "error" && (
              <span className="text-rose-300">
                {saveError}{" "}
                <button type="button" className="underline" onClick={() => void save(goals)}>Retry</button>
              </span>
            )}
          </p>
        </div>
      </div>

      {loadError && <p role="alert" className="mb-3 rounded bg-rose-900/60 p-2 text-sm text-rose-100">{loadError} Editing is disabled to protect the saved list. Reload the page to try again.</p>}

      {ready && (
        <form onSubmit={handleAddGoal} className="mb-4 flex flex-wrap gap-2">
          <input
            value={newGoalTitle}
            onChange={(event) => setNewGoalTitle(event.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder='New main goal, e.g. "Expand Factory Capacity in Rizal"'
            aria-label="New main goal"
            className={`${INPUT_CLASS} min-w-64`}
          />
          <button type="submit" disabled={generating || !newGoalTitle.trim()} className="rounded bg-cyan-500 px-3 py-1 text-sm font-semibold text-zinc-950 disabled:opacity-40">
            {generating ? "Generating steps…" : "Add New Main Goal"}
          </button>
        </form>
      )}
      {goalNotice && <p role="status" className="mb-3 rounded bg-amber-900/50 p-2 text-sm text-amber-100">{goalNotice}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {ready &&
          goals.map((goal, goalIndex) => {
            const progress = goalProgress(goal);
            const stepLimitReached = goal.steps.length >= MAX_STEPS_PER_GOAL;
            return (
              <article key={goal.id} className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
                <header className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-zinc-50">{goalIndex + 1}) {goal.title}</h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[progress.status]}`}>
                      {progress.status === "complete" ? "✓ " : ""}{STATUS_LABEL[progress.status]}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete goal ${goal.title}`}
                      className="text-xs text-rose-300 hover:text-rose-200"
                      onClick={() => {
                        if (window.confirm(`Delete "${goal.title}" and all of its steps?`)) mutate((current) => deleteGoal(current, goal.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </header>

                <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.title} progress`}>
                    <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <span>{progress.done}/{progress.total} · {progress.percent}%</span>
                </div>

                <ol className="space-y-2">
                  {goal.steps.map((step) => (
                    <li key={step.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-emerald-500"
                        checked={step.done}
                        aria-label={`Mark "${step.title || "step"}" done`}
                        onChange={(event) => mutate((current) => toggleStep(current, step.id, event.target.checked))}
                      />
                      <input
                        value={step.title}
                        maxLength={MAX_TITLE_LENGTH}
                        aria-label="Step text"
                        onChange={(event) => mutate((current) => setStepTitle(current, step.id, event.target.value))}
                        onBlur={() => {
                          if (!step.title.trim()) mutate((current) => deleteStep(current, step.id));
                        }}
                        className={`${INPUT_CLASS} ${step.done ? "text-emerald-300 line-through" : ""}`}
                      />
                      <button type="button" aria-label="Delete step" className="shrink-0 text-xs text-rose-300 hover:text-rose-200" onClick={() => mutate((current) => deleteStep(current, step.id))}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>

                <div className="mt-3 flex gap-2">
                  <input
                    value={stepDrafts[goal.id] ?? ""}
                    onChange={(event) => setStepDrafts((drafts) => ({ ...drafts, [goal.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddStep(goal.id);
                      }
                    }}
                    maxLength={MAX_TITLE_LENGTH}
                    placeholder={stepLimitReached ? `Step limit (${MAX_STEPS_PER_GOAL}) reached` : "Add a step"}
                    aria-label={`Add a step to ${goal.title}`}
                    disabled={stepLimitReached}
                    className={INPUT_CLASS}
                  />
                  <button type="button" className={BUTTON_CLASS} disabled={stepLimitReached || !(stepDrafts[goal.id] ?? "").trim()} onClick={() => handleAddStep(goal.id)}>
                    Add step
                  </button>
                </div>
              </article>
            );
          })}
      </div>

      {ready && goals.length === 0 && <p className="text-sm text-zinc-400">No main goals yet. Add one above.</p>}
    </section>
  );
}
