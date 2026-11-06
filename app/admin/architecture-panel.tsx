"use client";

import { useEffect, useId, useState } from "react";

const DIAGRAM = `flowchart LR
  subgraph INGEST["1. Lead Ingestion"]
    direction TB
    META["Meta Webhook<br/>app/api/webhooks/meta"] --> CRM["CRM Auto-Sync<br/>crm.ts upsert"]
    CRM --> LEADDB[("Supabase DB<br/>crm_contacts, leads, orders")]
  end
  subgraph CONTENT["2. Content Engine"]
    direction TB
    BUCKET[("Supabase Storage<br/>media-ad-renders")] --> RESUME["Resumable upload<br/>start, transfer, finish"]
    RESUME --> PUBLISH["Meta Graph API<br/>publish to Page / IG"]
    PUBLISH --> CAL[("content_calendar<br/>PUBLISHED")]
  end
  subgraph CRON["3. Cron Automation"]
    direction TB
    VCRON["Vercel native cron<br/>0 22 * * * UTC = 06:00 Manila"] --> BRIEF["/api/cron/executive-briefing"]
    BRIEF --> TGB["Telegram executive briefing"]
  end
  subgraph STOCK["4. Order and Stock System"]
    direction TB
    ORDER["Order / PO stock deduction"] --> THRESH["Threshold rules<br/>inventory-alerts-logic"]
    THRESH --> TGA["Telegram stock alert"]
    ORDER --> SYNC["Direct CRM sync<br/>crm.ts"]
  end
  SYNC --> LEADDB
  CAL -. "daily briefing reads" .-> BRIEF`;

export default function ArchitecturePanel() {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
        const id = `arch-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const { svg: rendered } = await mermaid.render(id, DIAGRAM);
        if (!cancelled) setSvg(rendered);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Diagram failed to render.");
      }
    })();
    return () => { cancelled = true; };
  }, [reactId]);

  return (
    <section aria-label="System architecture" className="rounded-2xl border border-cyan-400/20 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_24px_-6px_rgba(34,211,238,0.35)]">
      <h2 className="mb-1 text-lg font-bold text-cyan-200">System architecture</h2>
      <p className="mb-3 text-sm text-zinc-400">Live topology of lead ingestion, content publishing, cron automation, and order/stock sync.</p>
      {error && <p className="text-sm text-red-400">Could not render the diagram: {error}</p>}
      {!error && !svg && <p className="text-sm text-zinc-400">Rendering diagram…</p>}
      {svg && <div className="overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />}
    </section>
  );
}
