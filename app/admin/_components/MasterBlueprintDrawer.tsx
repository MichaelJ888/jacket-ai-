"use client";

import { useEffect, useState } from "react";
import {
  BLUEPRINT_ITEM_COUNT,
  MJIC_MASTER_BLUEPRINT,
  type BlueprintItem,
  type BlueprintSize,
  type BlueprintStatus,
} from "../_data/mjic-master-blueprint";

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
  const items = MJIC_MASTER_BLUEPRINT.reduce<BlueprintItem[]>(
    (all, phase) => [...all, ...phase.items],
    [],
  );
  const doneCount = items.filter((item) => item.status === "done").length;
  const pendingCount = items.length - doneCount;
  const completion = Math.round((doneCount / BLUEPRINT_ITEM_COUNT) * 100);

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

      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="sr-only" htmlFor="blueprint-search">Search blueprint</label>
        <input
          id="blueprint-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search: quote, Meta, visitor logs…"
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

      <div className="space-y-6">
        {MJIC_MASTER_BLUEPRINT.map((phase) => {
          const visibleItems = phase.items.filter((item) => matchesFilter(item, filter, query));
          if (visibleItems.length === 0) return null;
          return (
            <section key={phase.id} aria-labelledby={`${phase.id}-title`}>
              <div className="mb-3">
                <h3 id={`${phase.id}-title`} className="text-lg font-bold text-white">{phase.title}</h3>
                <p className="text-sm text-zinc-400">{phase.description}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setSelected(item); setCopyMessage(""); }}
                    className="group rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-left transition hover:border-cyan-300/60 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={`Inspect ${item.title}; ${item.status === "done" ? "done" : "pending action"}`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-zinc-100 group-hover:text-white">{item.title}</span>
                      <StatusBadge status={item.status} />
                    </span>
                    <span className="mt-3 block text-sm leading-relaxed text-zinc-400">{item.summary}</span>
                    <span className="mt-3 block text-xs font-semibold text-cyan-200">Pindutin para makita ang Taglish guide →</span>
                  </button>
                ))}
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
              <button
                type="button"
                autoFocus
                onClick={() => setSelected(null)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                aria-label="Close blueprint details"
              >
                Close
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
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
