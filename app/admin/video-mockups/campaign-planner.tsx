"use client";

import { useState } from "react";

import { buildCampaignPlan, makeCampaignFilename, SOCIAL_PLATFORMS, type CampaignInput } from "./campaign-logic";

type Props = {
  input: CampaignInput;
  onChange: (input: CampaignInput) => void;
  disabled: boolean;
};

const inputClass = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";

export default function CampaignPlanner({ input, onChange, disabled }: Props) {
  const [error, setError] = useState("");
  const plan = buildCampaignPlan(input);

  function downloadPlan() {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = makeCampaignFilename(input.clientName);
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the campaign draft.");
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Video ad campaign planner</h2>
      <p className="mt-2 text-sm text-zinc-600">Free, template-based copy and multi-account planning. This is not an AI model call, an account connection, or a scheduled post.</p>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-lg border border-green-200 bg-green-50 p-3"><strong>Selected: free browser preview</strong><p className="mt-1">Use your real product photo or approved mockup. No video-provider charge. Tab must stay open; no unattended rendering.</p></div>
        <div className="rounded-lg border border-zinc-200 p-3"><strong>Optional: existing paid AI video</strong><p className="mt-1">The system has Veo / AI Gateway generation. Separate credentials, provider billing, and approval apply. Not started by this planner.</p></div>
        <div className="rounded-lg border border-zinc-200 p-3"><strong>Later: FFmpeg / Remotion</strong><p className="mt-1">A worker can assemble real footage and MP4 ads. Not installed or enabled in this browser-only rollout. CapCut remains a manual editing option.</p></div>
      </div>

      <fieldset disabled={disabled} className="mt-5 grid gap-5 disabled:opacity-60 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="campaign-product">Product label</label>
          <input id="campaign-product" className={inputClass} maxLength={54} value={input.productName} onChange={(event) => onChange({ ...input, productName: event.target.value })} />
          <label className="mt-3 block text-sm font-medium" htmlFor="campaign-cta">Call to action</label>
          <input id="campaign-cta" className={inputClass} maxLength={64} value={input.callToAction} onChange={(event) => onChange({ ...input, callToAction: event.target.value })} />
          <label className="mt-3 block text-sm font-medium" htmlFor="campaign-language">Caption language</label>
          <select id="campaign-language" className={inputClass} value={input.language} onChange={(event) => onChange({ ...input, language: event.target.value === "taglish" ? "taglish" : "english" })}>
            <option value="english">English</option>
            <option value="taglish">Taglish</option>
          </select>
          <h3 className="mt-4 text-sm font-semibold">Caption draft</h3>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-sm" data-testid="campaign-caption">{plan.caption}{"\n\n"}{plan.hashtags.join(" ")}</p>
          <h3 className="mt-3 text-sm font-semibold">Suggested voiceover (text only)</h3>
          <p className="mt-1 text-sm text-zinc-600">{plan.voiceoverSuggestion}</p>
          <p className="mt-1 text-xs text-zinc-500">The video is silent. Record and time this copy separately; it is not synthesized or embedded.</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Platform and account targets</h3>
          <p className="mt-1 text-xs text-zinc-600">One account label per line. Labels are local planning notes, not verified connections. Do not paste passwords or access tokens.</p>
          {SOCIAL_PLATFORMS.map((platform) => {
            const selected = input.platforms.includes(platform.id);
            return (
              <div key={platform.id} className="mt-3 rounded-lg border border-zinc-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={selected} onChange={() => onChange({ ...input, platforms: selected ? input.platforms.filter((id) => id !== platform.id) : [...input.platforms, platform.id] })} />
                  {platform.label}
                </label>
                {selected && <>
                  <label className="mt-2 block text-xs" htmlFor={`accounts-${platform.id}`}>{platform.label} account labels</label>
                  <textarea id={`accounts-${platform.id}`} className={inputClass} rows={2} maxLength={2000} placeholder={platform.id === "other" ? "Pinterest @mjic\nX @mjic" : "MJIC Main\nMJIC Sales"} value={input.accountLabels[platform.id] || ""} onChange={(event) => onChange({ ...input, accountLabels: { ...input.accountLabels, [platform.id]: event.target.value } })} />
                  <p className="mt-1 text-xs text-zinc-500">{platform.requirement}</p>
                </>}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Draft only - approved campaigns only may be published.</strong>
        <p className="mt-1">This planner never uploads, approves, schedules, or publishes. Existing automatic posting is separate and currently targets one configured account per supported platform, not every connected account. WebM may need MP4/H.264 conversion before publishing.</p>
      </div>
      <button className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={disabled || !input.platforms.length} onClick={downloadPlan}>Download campaign draft JSON</button>
      {!input.platforms.length && <p className="mt-2 text-sm text-amber-900">Select at least one platform to export a campaign.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-xs text-zinc-500">Downloaded drafts persist only where you save them. Unsaved settings are lost on reload. For account authorization, use <a className="underline" href="/dashboard/connect">Connect Facebook / Instagram</a>. Other networks need their own integrations.</p>
    </section>
  );
}
