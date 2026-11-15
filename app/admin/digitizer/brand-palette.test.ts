import assert from "node:assert/strict";
import test from "node:test";
import { closestMjicBrandColor } from "./brand-palette.ts";

test("maps thread colors to the nearest MJIC brand palette color", () => {
  assert.equal(closestMjicBrandColor("#0D213F")?.name, "Corporate Navy");
  assert.equal(closestMjicBrandColor("#D4A843")?.name, "Executive Gold");
  assert.equal(closestMjicBrandColor("invalid"), null);
});
