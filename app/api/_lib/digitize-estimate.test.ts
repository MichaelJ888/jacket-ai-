import assert from "node:assert/strict";
import test from "node:test";
import { estimateStitchCount } from "./digitize-estimate.ts";

test("estimates planning stitches from area and treats invalid dimensions as zero", () => {
  assert.equal(estimateStitchCount(3, 2), 7200);
  assert.equal(estimateStitchCount(-1, 2), 0);
  assert.equal(estimateStitchCount(2, 1, 1000), 2000);
});
