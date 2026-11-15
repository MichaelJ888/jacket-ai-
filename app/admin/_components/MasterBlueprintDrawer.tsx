"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  MJIC_MASTER_BLUEPRINT,
  type BlueprintItem,
  type BlueprintPhase,
  type BlueprintSize,
  type BlueprintStatus,
} from "../_data/mjic-master-blueprint";
import { isValidResendFrom } from "./blueprint-logic";

type Filter = "all" | BlueprintStatus | BlueprintSize;

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "done", label: "Completed (Green)" },
  { id: "pending", label: "Remaining To-Do" },
  { id: "major", label: "Major Engines" },
  { id: "micro", label: "Micro Details" },
];

const FLOW = [
  "Customer visits the MJIC storefront",
  "AI sales helper guides and prices the request",
  "Admin confirms the lead, quote, and production work",
  "Supabase safely stores the business records",
  "Cloud tools support follow-up and social publishing",
];

const CUSTOM_TASKS_KEY = "mjic-admin-blueprint-custom-tasks-v1";
const CUSTOM_TASKS_CHANGED_EVENT = "mjic-blueprint-custom-tasks-changed";
const CUSTOM_TASKS_STORAGE_ERROR = "__MJIC_CUSTOM_TASKS_STORAGE_ERROR__";
const MAX_CUSTOM_TASKS = 30;

type CustomTask = { id: string; title: string };
type ParsedCustomTasks = { tasks: CustomTask[]; error: string };
type LiveHealth = {
  status: string;
  time?: string;
  optionalIntegrations: Record<string, boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCustomTasksSnapshot(): string {
  try {
    return window.localStorage.getItem(CUSTOM_TASKS_KEY) ?? "[]";
  } catch {
    return CUSTOM_TASKS_STORAGE_ERROR;
  }
}

function getServerCustomTasksSnapshot(): string {
  return "[]";
}

function subscribeToCustomTasks(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CUSTOM_TASKS_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CUSTOM_TASKS_CHANGED_EVENT, onChange);
  };
}

function parseCustomTasks(snapshot: string): ParsedCustomTasks {
  if (snapshot === CUSTOM_TASKS_STORAGE_ERROR) {
    return { tasks: [], error: "Browser storage is unavailable; custom tasks cannot be persisted." };
  }
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) throw new Error("Saved custom tasks are invalid.");
    const tasks = parsed.flatMap((entry): CustomTask[] => {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.title !== "string") return [];
      const title = entry.title.trim();
      return entry.id.startsWith("custom-") && title.length >= 3 && title.length <= 120
        ? [{ id: entry.id, title }]
        : [];
    }).slice(0, MAX_CUSTOM_TASKS);
    return { tasks, error: "" };
  } catch (error) {
    return {
      tasks: [],
      error: error instanceof Error ? error.message : "Could not read browser-saved tasks.",
    };
  }
}

function saveCustomTasks(tasks: CustomTask[]): string {
  try {
    window.localStorage.setItem(CUSTOM_TASKS_KEY, JSON.stringify(tasks));
    window.dispatchEvent(new Event(CUSTOM_TASKS_CHANGED_EVENT));
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not save tasks in this browser.";
  }
}

function parseHealth(value: unknown): LiveHealth {
  if (!isRecord(value)) throw new Error("Health response was not a JSON object.");
  const optionalIntegrations: Record<string, boolean> = {};
  if (isRecord(value.optionalIntegrations)) {
    for (const [key, configured] of Object.entries(value.optionalIntegrations)) {
      if (typeof configured === "boolean") optionalIntegrations[key] = configured;
    }
  }
  return {
    status: typeof value.status === "string" ? value.status : "unknown",
    time: typeof value.time === "string" ? value.time : undefined,
    optionalIntegrations,
  };
}

function customTaskItem(task: CustomTask): BlueprintItem {
  const nextSteps = [
    "Ilinaw ang acceptance criteria at owner.",
    "I-verify ang apektadong workflow bago mag-release.",
  ];
  return {
    id: task.id,
    title: task.title,
    status: "pending",
    size: "micro",
    summary: "Custom admin task saved in this browser only.",
    paraSaan: "Idinagdag ito bilang lokal na follow-up task.",
    purpose: "Ilinaw at kumpletuhin ang nawawalang MJIC work item.",
    magagawa: "Nagbibigay ito ng lokal na checklist entry sa blueprint.",
    kayaGawin: "Hindi ito ipinapadala sa server o sa AI provider.",
    epekto: "Makikita ito sa blueprint sa browser na ito.",
    stepByStep: nextSteps,
    nextSteps,
    verdict: "Local suggestion only; it has not been implemented or synchronized to Supabase.",
    compactDetails: true,
  };
}

function getNextSteps(item: BlueprintItem): readonly string[] {
  if (item.nextSteps?.length) return item.nextSteps;
  if (item.status === "pending") return ["Complete the pending implementation guide above, then verify the result."];
  return ["No implementation task is recorded; keep the behavior covered by regression checks and review live health when relevant."];
}

function getVerdict(item: BlueprintItem): string {
  return item.verdict ?? (item.status === "done"
    ? "Implemented according to the blueprint; this status does not independently certify production behavior."
    : "A follow-up action is still recorded; verify it before marking this complete.");
}

function getLiveIndicator(item: BlueprintItem, health: LiveHealth | null, healthError: string) {
  if (healthError && health) return { label: "HEALTH STALE", ready: false };
  if (!health) return { label: healthError ? "HEALTH UNAVAILABLE" : "HEALTH SYNCING", ready: false };
  if (item.healthKeys?.length) {
    const values = item.healthKeys.map((key) => health.optionalIntegrations[key]);
    if (values.some((value) => typeof value !== "boolean")) {
      return { label: "CONFIG CHECK UNAVAILABLE", ready: false };
    }
    return values.every(Boolean)
      ? { label: "CONFIGURED", ready: true }
      : { label: "CONFIG NEEDED", ready: false };
  }
  return item.status === "done"
    ? { label: "IMPLEMENTED · NOT LIVE-CHECKED", ready: false }
    : { label: "OWNER ACTION", ready: false };
}

function matchesFilter(item: BlueprintItem, filter: Filter, query: string) {
  const matchesType = filter === "all" || item.status === filter || item.size === filter;
  const searchable = [
    item.title,
    item.summary,
    item.paraSaan,
    item.purpose,
    item.magagawa,
    item.kayaGawin,
    item.epekto,
    item.verdict ?? "",
    ...(item.nextSteps ?? []),
    ...(item.healthKeys ?? []),
    ...item.stepByStep,
    ...(item.copyValues?.flatMap(({ label, value }) => [label, value]) ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return matchesType && searchable.includes(query.trim().toLocaleLowerCase());
}

function StatusBadge({ status }: { status: BlueprintStatus }) {
  return status === "done" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-400/15 px-3 py-1 text-xs font-bold tracking-wide text-emerald-200 shadow-[0_0_16px_-4px_rgba(52,211,153,0.8)]">
      <span aria-hidden="true">✓</span> DONE
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-amber-300/50 bg-amber-400/15 px-3 py-1 text-xs font-bold tracking-wide text-amber-200">
      PENDING ACTION
    </span>
  );
}

export default function MasterBlueprintDrawer() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BlueprintItem | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [customTaskMessage, setCustomTaskMessage] = useState("");
  const [health, setHealth] = useState<LiveHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [healthCheckedAt, setHealthCheckedAt] = useState("");
  const [v0Focus, setV0Focus] = useState("high-converting B2B uniform procurement");
  const [promptMessage, setPromptMessage] = useState("");
  const [senderInput, setSenderInput] = useState("");
  const [senderMessage, setSenderMessage] = useState("");
  const customTasksSnapshot = useSyncExternalStore(
    subscribeToCustomTasks,
    getCustomTasksSnapshot,
    getServerCustomTasksSnapshot,
  );
  const { tasks: customTasks, error: customTaskStorageError } = parseCustomTasks(customTasksSnapshot);
  const customItems = customTasks.map(customTaskItem);
  const phases: readonly BlueprintPhase[] = customItems.length
    ? [
        ...MJIC_MASTER_BLUEPRINT,
        {
          id: "local-custom-tasks",
          title: "Browser-only Custom Tasks",
          description: "Local suggestions saved only in this browser.",
          items: customItems,
        },
      ]
    : MJIC_MASTER_BLUEPRINT;
  const items = phases.reduce<BlueprintItem[]>(
    (all, phase) => [...all, ...phase.items],
    [],
  );
  const promptFocus = v0Focus.trim() || "high-converting B2B uniform procurement";
  const v0Prompt = `Design a polished, high-converting B2B website for Michael Jeffrey International Corporation (MJIC), a Philippine custom uniform and embroidery supplier. Page goal: ${promptFocus}. Use a premium navy-and-gold visual system, clear procurement steps, trustworthy production proof, transparent quote entry points, mobile-first layouts, accessible contrast, keyboard-friendly controls, and concise business-focused copy. Prioritize product catalogue, fabric and quantity selection, MOQ/pricing guidance, quotation CTA, payment instructions, production updates, FAQs, and contact. Use reusable responsive components, realistic garment imagery, strong hierarchy, and clear loading, empty, validation, and error states. Do not invent prices, certifications, customer testimonials, payment QR details, or production claims; mark unknown business facts for owner confirmation.`;
  const doneCount = items.filter((item) => item.status === "done").length;
  const pendingCount = items.length - doneCount;
  const completion = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  useEffect(() => {
    let active = true;
    let checking = false;
    async function refreshHealth() {
      if (checking) return;
      checking = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        const snapshot = parseHealth(await response.json());
        if (!active) return;
        setHealth(snapshot);
        setHealthCheckedAt(snapshot.time ?? new Date().toISOString());
        setHealthError("");
      } catch (error) {
        if (!active) return;
        setHealthError(error instanceof Error ? error.message : "Health check failed.");
      } finally {
        window.clearTimeout(timeout);
        checking = false;
      }
    }
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} nakopya na.`);
    } catch {
      setCopyMessage(`Hindi makopya ang ${label}. Piliin at kopyahin ito nang mano-mano.`);
    }
  }

  async function copyV0Prompt() {
    try {
      await navigator.clipboard.writeText(v0Prompt);
      setPromptMessage("v0 prompt copied.");
    } catch (error) {
      setPromptMessage(error instanceof Error ? error.message : "Could not copy the prompt.");
    }
  }

  function addCustomTask() {
    const title = query.trim();
    if (title.length < 3 || title.length > 120) {
      setCustomTaskMessage("Enter a task between 3 and 120 characters.");
      return;
    }
    if (items.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setCustomTaskMessage("That feature or task is already in the list.");
      return;
    }
    if (customTasks.length >= MAX_CUSTOM_TASKS) {
      setCustomTaskMessage(`This browser can save up to ${MAX_CUSTOM_TASKS} custom tasks.`);
      return;
    }
    const task = { id: `custom-${crypto.randomUUID()}`, title };
    const saveError = saveCustomTasks([...customTasks, task]);
    if (saveError) {
      setCustomTaskMessage(saveError);
      return;
    }
    setCustomTaskMessage("Saved in this browser only; not synced to Supabase.");
    setFilter("all");
    setQuery("");
    setSelected(customTaskItem(task));
    setCopyMessage("");
  }

  function validateSender() {
    setSenderMessage(isValidResendFrom(senderInput)
      ? "Format is valid. Set the exact value in Vercel Environment Variables; this check does not save or send email."
      : "Enter a valid address (email@example.com or MJIC <email@example.com>) without line breaks or comma-separated recipients.");
  }

  function removeCustomTask(taskId: string) {
    const saveError = saveCustomTasks(customTasks.filter((task) => task.id !== taskId));
    if (saveError) {
      setCustomTaskMessage(saveError);
      return;
    }
    setSelected(null);
    setCustomTaskMessage("Custom task removed from this browser.");
  }

  return (
    <section className="space-y-6 rounded-2xl border border-cyan-300/20 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_32px_-12px_rgba(34,211,238,0.35)] sm:p-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">MJIC System Map</p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">End-to-End Master Blueprint</h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              Simpleng mapa ng mga engine, maliliit na detalye, at owner actions ng MJIC AI system.
            </p>
          </div>
          <div className="text-sm text-zinc-300" aria-live="polite">
            <strong className="text-emerald-300">{completion}% Complete</strong>
            <span className="mx-2">·</span>
            <span>{doneCount} Done</span>
            <span className="mx-2">·</span>
            <span>{pendingCount} Pending</span>
          </div>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-label="Blueprint completion"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width]"
            style={{ width: `${completion}%` }}
          />
        </div>
        <p className="text-xs text-zinc-400">{items.length} checklist items · status reflects implemented code or owner action still required.</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs" aria-live="polite">
          <strong className="text-zinc-200">Live health:</strong>
          <span className={health?.status === "ok" ? "text-emerald-300" : health ? "text-amber-300" : "text-rose-300"}>
            {health ? health.status.toUpperCase() : healthError ? "UNAVAILABLE" : "CHECKING"}
          </span>
          <span className="text-zinc-400">
            {healthCheckedAt ? `Checked ${new Date(healthCheckedAt).toLocaleTimeString()}` : healthError || "Syncs every 60 seconds"}
          </span>
          <span className="text-zinc-500">Configuration indicators expose booleans only, never environment values.</span>
        </div>
      </header>

      <section aria-labelledby="blueprint-flow-title" className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-4">
        <h3 id="blueprint-flow-title" className="mb-3 text-base font-semibold text-cyan-200">
          How the Whole MJIC AI Machine Works End-to-End
        </h3>
        <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {FLOW.map((step, index) => (
            <li key={step} className="flex min-h-20 items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-cyan-300/15 font-bold text-cyan-200">
                {index + 1}
              </span>
              <span className="text-zinc-200">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-zinc-400">
          Bumisita ang customer → tumutulong ang sales tools → kinukumpirma ng team → ligtas ang records → umaandar ang cloud follow-up.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-cyan-300/20 bg-zinc-900/80 p-4">
          <h3 className="font-semibold text-cyan-200">v0.app Futuristic UI/UX Prompt Generator</h3>
          <label className="block text-xs text-zinc-300" htmlFor="v0-focus">Page or conversion goal</label>
          <input
            id="v0-focus"
            value={v0Focus}
            onChange={(event) => setV0Focus(event.target.value)}
            maxLength={120}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
          />
          <label className="sr-only" htmlFor="v0-prompt-output">Generated v0.app prompt</label>
          <textarea
            id="v0-prompt-output"
            readOnly
            rows={7}
            value={v0Prompt}
            className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-200"
          />
          <button
            type="button"
            onClick={() => void copyV0Prompt()}
            className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            Copy v0 prompt
          </button>
          <p className="text-xs text-zinc-400" aria-live="polite">{promptMessage || "Static template; no AI request or provider cost."}</p>
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/80 p-4">
          <h3 className="font-semibold text-cyan-200">RESEND_FROM Quick Validator</h3>
          <label className="block text-xs text-zinc-300" htmlFor="resend-from">Sender value to validate</label>
          <input
            id="resend-from"
            type="text"
            autoComplete="off"
            maxLength={320}
            value={senderInput}
            onChange={(event) => { setSenderInput(event.target.value); setSenderMessage(""); }}
            placeholder="MJIC Quotes <quotes@example.com>"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={validateSender}
              className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              Validate sender
            </button>
            <span className={health?.optionalIntegrations.RESEND_FROM ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
              Production env: {health?.optionalIntegrations.RESEND_FROM ? "configured" : health ? "not configured" : "checking"}
            </span>
          </div>
          <p className="text-xs text-zinc-400" aria-live="polite">
            {senderMessage || "Format check only; it does not change Vercel settings or send a test email."}
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="sr-only" htmlFor="blueprint-search">Search blueprint</label>
        <input
          id="blueprint-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search or type a missing task…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter blueprint items">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                filter === option.id
                  ? "border-cyan-200 bg-cyan-300 text-zinc-950"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-cyan-300/60"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {query.trim() && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3">
          <button
            type="button"
            onClick={addCustomTask}
            className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            Add “{query.trim().slice(0, 60)}” as a custom task
          </button>
          <span className="text-xs text-zinc-400">Saved locally in this browser only · max {MAX_CUSTOM_TASKS}</span>
        </div>
      )}
      {(customTaskMessage || customTaskStorageError) && (
        <p className="text-xs text-amber-200" aria-live="polite">{customTaskMessage || customTaskStorageError}</p>
      )}

      <div className="space-y-6">
        {phases.map((phase) => {
          const visibleItems = phase.items.filter((item) => matchesFilter(item, filter, query));
          if (visibleItems.length === 0) return null;
          return (
            <section key={phase.id} aria-labelledby={`${phase.id}-title`}>
              <div className="mb-3">
                <h3 id={`${phase.id}-title`} className="text-lg font-bold text-white">{phase.title}</h3>
                <p className="text-sm text-zinc-400">{phase.description}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {visibleItems.map((item) => {
                  const indicator = getLiveIndicator(item, health, healthError);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelected(item); setCopyMessage(""); }}
                      className="group rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-left transition hover:border-cyan-300/60 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      aria-label={`Inspect ${item.title}; ${item.status === "done" ? "done" : "pending action"}; ${indicator.label}`}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-zinc-100 group-hover:text-white">{item.title}</span>
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={item.status} />
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${indicator.ready ? "border-emerald-400/40 text-emerald-200" : "border-amber-300/40 text-amber-200"}`}>
                            {indicator.label}
                          </span>
                        </span>
                      </span>
                      <span className="mt-3 block text-sm leading-relaxed text-zinc-400">{item.summary}</span>
                      <span className="mt-3 block text-xs font-semibold text-cyan-200">Pindutin para makita ang Taglish guide →</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {items.filter((item) => matchesFilter(item, filter, query)).length === 0 && (
          <p className="rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-center text-sm text-zinc-400">
            Walang checklist item na tumugma. Subukan ang ibang salita o filter.
          </p>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="blueprint-drawer-title"
            className="flex h-full w-full max-w-xl flex-col border-l border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
              <div className="space-y-2">
                <StatusBadge status={selected.status} />
                <h2 id="blueprint-drawer-title" className="text-xl font-bold">{selected.title}</h2>
                <p className="text-sm text-zinc-400">{selected.summary}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                {selected.id.startsWith("custom-") && (
                  <button
                    type="button"
                    onClick={() => removeCustomTask(selected.id)}
                    className="rounded-lg border border-rose-400/40 px-3 py-2 text-sm text-rose-200 hover:bg-rose-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  >
                    Remove task
                  </button>
                )}
                <button
                  type="button"
                  autoFocus
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  aria-label="Close blueprint details"
                >
                  Close
                </button>
              </div>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {!selected.compactDetails && (
                <>
                  <Detail title="Para saan ito?" text={selected.paraSaan} />
                  <Detail title="Purpose sa negosyo ng MJIC" text={selected.purpose} />
                  <Detail title="Ano ang magagawa nito?" text={selected.magagawa} />
                  <Detail title="Ano ang kaya nitong gawin nang kusa?" text={selected.kayaGawin} />
                  <Detail title="Ano ang magiging epekto?" text={selected.epekto} />
                  <section>
                    <h3 className="mb-2 font-semibold text-cyan-200">Step-by-step guide</h3>
                    <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-300">
                      {selected.stepByStep.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </section>
                </>
              )}
              <Detail title="Verdict" text={getVerdict(selected)} />
              <section>
                <h3 className="mb-2 font-semibold text-cyan-200">Next Steps to Do</h3>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-300">
                  {getNextSteps(selected).map((step) => <li key={step}>{step}</li>)}
                </ol>
              </section>
              {selected.copyValues && (
                <section>
                  <h3 className="mb-2 font-semibold text-cyan-200">Setup values / URLs</h3>
                  <ul className="space-y-2">
                    {selected.copyValues.map(({ label, value }) => (
                      <li key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                        <span className="block text-xs text-zinc-400">{label}</span>
                        <code className="mt-1 block break-all text-sm text-zinc-100">{value}</code>
                        <button
                          type="button"
                          onClick={() => void copyValue(label, value)}
                          className="mt-2 rounded border border-zinc-700 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p aria-live="polite" className="mt-2 min-h-5 text-xs text-emerald-300">{copyMessage}</p>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Detail({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h3 className="mb-1 font-semibold text-cyan-200">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-300">{text}</p>
    </section>
  );
}
