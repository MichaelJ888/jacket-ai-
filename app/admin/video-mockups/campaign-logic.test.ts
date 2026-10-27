import assert from "node:assert/strict";
import test from "node:test";

import { buildCampaignPlan, makeCampaignFilename, SOCIAL_PLATFORMS, type CampaignInput } from "./campaign-logic.ts";

const input: CampaignInput = {
  clientName: "MJIC Team",
  productName: "Corporate jackets",
  callToAction: "Message us",
  language: "english",
  platforms: ["facebook", "instagram", "youtube", "tiktok"],
  accountLabels: {},
};

test("local campaigns never claim approval, scheduling, paid generation, or connected accounts", () => {
  const plan = buildCampaignPlan(input);
  assert.equal(plan.status, "DRAFT");
  assert.equal(plan.approvalStatus, "NOT_SUBMITTED");
  assert.equal(plan.publishingPolicy, "APPROVED_CAMPAIGNS_ONLY");
  assert.equal(plan.autoPublishEligible, false);
  assert.equal(plan.queuedForPublishing, false);
  assert.equal(plan.rendering.providerChargeUsd, 0);
  assert.equal(plan.rendering.audioIncluded, false);
  assert.equal(plan.rendering.mimeType, "video/webm");
  assert.equal(plan.targets.length, 4);
  assert.ok(plan.targets.every((target) => !target.accountVerified && target.status === "NEEDS_ACCOUNT_SELECTION"));
  assert.equal(plan.storyboard.at(-1)?.endSeconds, plan.rendering.durationSeconds);
});

test("expands distinct account labels without treating them as authorized publishing destinations", () => {
  const plan = buildCampaignPlan({ ...input, platforms: ["facebook"], accountLabels: { facebook: " MJIC Main \nMJIC Sales\nMJIC Main\n\n", instagram: "not selected" } });
  assert.deepEqual(plan.targets.map((target) => target.accountLabel), ["MJIC Main", "MJIC Sales"]);
  assert.ok(plan.targets.every((target) => target.platform === "facebook" && target.status === "NEEDS_ACCOUNT_VERIFICATION"));
});

test("Taglish copy preserves supplied product and CTA without inventing prices or delivery promises", () => {
  const plan = buildCampaignPlan({ ...input, language: "taglish" });
  assert.match(plan.caption, /Corporate jackets para sa MJIC Team/);
  assert.match(plan.caption, /Message us/);
  assert.match(plan.voiceoverSuggestion, /Sariling design/);
  assert.doesNotMatch(plan.caption, /free|discount|delivery|₱|\bPHP\b/i);
});

test("unsupported networks stay manual and TikTok requirements remain explicit", () => {
  const plan = buildCampaignPlan({ ...input, platforms: SOCIAL_PLATFORMS.map((platform) => platform.id), accountLabels: { other: "Pinterest @mjic\nX @mjic" } });
  assert.ok(plan.targets.filter((target) => ["linkedin", "other"].includes(target.platform)).every((target) => target.integration === "manual-export"));
  assert.match(plan.targets.find((target) => target.platform === "tiktok")!.requirement, /audit/);
  assert.ok(plan.targets.every((target) => target.exportRequirement.includes("MP4/H.264")));
});

test("empty selection stays empty and blank values get visible defaults", () => {
  const plan = buildCampaignPlan({ ...input, platforms: [], clientName: " ", productName: "", callToAction: "" });
  assert.deepEqual(plan.targets, []);
  assert.equal(plan.clientName, "YOUR TEAM");
  assert.equal(plan.productName, "Custom jackets and uniforms");
  assert.equal(plan.callToAction, "Message MJIC for a quotation");
});

test("campaign filenames are safe and bounded", () => {
  assert.equal(makeCampaignFilename("Équipe / MJIC"), "equipe-mjic-campaign-draft.json");
  assert.equal(makeCampaignFilename("!!!"), "mjic-jacket-campaign-draft.json");
  assert.ok(makeCampaignFilename("a".repeat(100)).length <= 68);
});
