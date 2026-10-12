import assert from "node:assert/strict";
import test from "node:test";

import {
  getWebmMimeType,
  makeVideoFilename,
  MAX_ARTWORK_BYTES,
  MAX_LOGO_BYTES,
  validateImageFile,
  VIDEO_DURATION_SECONDS,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "./mockup-logic.ts";

test("video dimensions and duration are a lightweight vertical social preview", () => {
  assert.deepEqual([VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS, VIDEO_DURATION_SECONDS], [720, 1280, 24, 8]);
});

test("accepts supported artwork types and rejects unsupported or oversized files", () => {
  assert.equal(validateImageFile({ name: "jacket.png", size: 100, type: "image/png" }, "artwork"), null);
  assert.equal(validateImageFile({ name: "jacket.svg", size: 100, type: "image/svg+xml" }, "artwork"), "Choose a PNG, JPEG, or WebP image.");
  assert.equal(validateImageFile({ name: "jacket.png", size: MAX_ARTWORK_BYTES + 1, type: "image/png" }, "artwork"), "Keep this image under 12 MB.");
  assert.equal(validateImageFile({ name: "jacket.png", size: 0, type: "image/png" }, "artwork"), "The selected image is empty.");
});

test("logo uploads use the smaller size limit", () => {
  assert.equal(validateImageFile({ name: "logo.png", size: MAX_LOGO_BYTES, type: "image/png" }, "logo"), null);
  assert.equal(validateImageFile({ name: "logo.png", size: MAX_LOGO_BYTES + 1, type: "image/png" }, "logo"), "Keep this image under 5 MB.");
});

test("selects the first browser-supported WebM codec, or reports unsupported recording", () => {
  assert.equal(getWebmMimeType((type) => type.includes("vp8")), "video/webm;codecs=vp8");
  assert.equal(getWebmMimeType(() => false), null);
});

test("video filenames are normalized and never empty", () => {
  assert.equal(makeVideoFilename("Équipe / MJIC 2026"), "equipe-mjic-2026-mockup.webm");
  assert.equal(makeVideoFilename("!!!"), "mjic-jacket-mockup.webm");
  assert.ok(makeVideoFilename("a".repeat(90)).length <= 64);
});
