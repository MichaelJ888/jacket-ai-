import assert from "node:assert/strict";
import test from "node:test";
import { BLUEPRINT_ITEM_COUNT, MJIC_MASTER_BLUEPRINT } from "../_data/mjic-master-blueprint.ts";
import { isValidResendFrom } from "./blueprint-logic.ts";

test("validates a plain Resend sender address", () => {
  assert.equal(isValidResendFrom("orders@example.com"), true);
});

test("validates a display name and sender address", () => {
  assert.equal(isValidResendFrom("MJIC Quotes <quotes@example.com>"), true);
});

test("rejects malformed or header-injected sender values", () => {
  for (const value of [
    "",
    "MJIC <quotes@example.com",
    "<quotes@example.com>",
    "quotes@example",
    "quotes@example.com\r\nBcc: victim@example.com",
    "quotes@example.com, victim@example.com",
  ]) {
    assert.equal(isValidResendFrom(value), false, value);
  }
});

test("blueprint includes every requested feature in its counted inventory", () => {
  const items = MJIC_MASTER_BLUEPRINT.flatMap((phase) => phase.items);
  const titles = new Set(items.map((item) => item.title));
  const requested = [
    "Lalamove",
    "Embroidery Digitizer",
    "Subcon Outreach",
    "Download HTML",
    "AI Logo Creator",
    "Mockup Design Creator",
    "Quotation Creators",
    "Checkout & Payment",
    "Choose Fabric",
    "Bulk Quotation",
    "Product Catalogue",
    "CEO AI Studio",
    "Client Journey Video",
    "Production Updates",
    "FAQs",
    "Contact",
    "Alex Eala & NBA Widgets",
    "World News",
    "AI Swarm",
    "Super Intelligent AI COO",
    "CRM/ERP",
    "Telegram Vercel AI",
    "Jacket Video Mockup",
    "Social Auto-Ads/SEO",
    "AI Swarm Employees",
    "UI/UX Futuristic Design",
    "AI Website Editor",
  ];

  assert.equal(items.length, BLUEPRINT_ITEM_COUNT);
  for (const title of requested) assert.equal(titles.has(title), true, title);
});
