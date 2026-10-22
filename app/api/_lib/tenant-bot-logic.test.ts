import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTenantPrompt, defaultHandoff, draftFromPage, EMPTY_PROFILE, profileProblems, sanitizeProfile } from './tenant-bot-logic.ts';

test('sanitize clamps, whitelists and never enables implicitly', () => {
  const p = sanitizeProfile({ business_name: ' Shop '.repeat(50), offers: 'x'.repeat(9000), tone: 'evil', language: 'klingon', enabled: 'true' });
  assert.ok(p.business_name.length <= 80);
  assert.equal(p.offers.length, 4000);
  assert.equal(p.tone, 'friendly');
  assert.equal(p.language, 'taglish');
  assert.equal(p.enabled, false);
  assert.equal(sanitizeProfile({ enabled: true }).enabled, true);
});

test('profile must have a name and facts before going live', () => {
  assert.equal(profileProblems(EMPTY_PROFILE).length, 2);
  assert.deepEqual(profileProblems({ ...EMPTY_PROFILE, business_name: 'Kape', offers: 'Latte 120, Americano 90, Mocha 130 - open daily 8am-8pm' }), []);
});

test('prompt contains the facts and the no-invention policy, and nothing of MJIC', () => {
  const prompt = buildTenantPrompt({ ...EMPTY_PROFILE, business_name: 'Kape', offers: 'Latte 120', tone: 'professional' }, { first: true });
  assert.match(prompt, /Business name: Kape/);
  assert.match(prompt, /Latte 120/);
  assert.match(prompt, /Never invent prices/);
  assert.match(prompt, /first message/);
  assert.doesNotMatch(prompt, /MJIC|jacket|GCash/i);
});

test('page autofill and handoff default', () => {
  const draft = draftFromPage({ name: 'Kape', about: 'Coffee', phone: '0917', website: 'k.ph' });
  assert.equal(draft.business_name, 'Kape');
  assert.match(draft.contact_info, /Phone: 0917/);
  assert.equal(draft.enabled, false);
  assert.match(defaultHandoff(draft), /Kape/);
});
