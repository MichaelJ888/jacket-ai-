import assert from "node:assert/strict";
import test from "node:test";
import { MJIC_FEATURES, normalizeCustomFeatures, routeFeatures, validCustomFeature } from "../../../lib/mjic-features.ts";

test("registry includes the priority digitizer, studio, and auto-post modules", () => {
  const ids = MJIC_FEATURES.map((feature) => feature.id);
  assert.ok(ids.includes("embroidery-digitizer"));
  assert.ok(ids.includes("ceo-ai-studio"));
  assert.ok(ids.includes("auto-social-ads-seo"));
});

test("detected route paths become deterministic registry entries", () => {
  assert.deepEqual(routeFeatures(["/", "/api/health"]).map(({ id, path }) => [id, path]), [
    ["route-home", "/"],
    ["route-api-health", "/api/health"],
  ]);
});

test("custom feature titles are validated, trimmed, deduplicated and capped", () => {
  assert.equal(validCustomFeature("  "), false);
  assert.deepEqual(normalizeCustomFeatures([" New Feature ", "new feature", "x"]), [
    { id: "custom-new-feature", title: "New Feature", source: "custom" },
  ]);
  assert.equal(normalizeCustomFeatures(Array.from({ length: 110 }, (_, index) => `Feature ${index}`)).length, 100);
});
