import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubconOutreachTemplate, isValidEmail, maySendSubconOutreach } from './subcon-outreach-logic.ts';

test('validates subcontractor email addresses', () => {
  assert.equal(isValidEmail('sewer@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('with spaces@example.com'), false);
});

test('creates an honest, opt-out-aware subcontractor inquiry', () => {
  const template = buildSubconOutreachTemplate('Sewing Partner', 'Jackets');
  assert.match(template.subject, /MJIC/);
  assert.match(template.text, /Jackets/);
  assert.match(template.text, /not a work order/);
  assert.match(template.text, /stop contacting you/);
});

test('requires active status, recorded opt-in evidence, and no opt-out for outreach', () => {
  const consent = {
    active: true,
    email: 'sewer@example.com',
    email_opt_in: true,
    email_opt_in_at: '2026-11-12T00:00:00.000Z',
    email_opt_in_evidence: 'Inbound email dated 2026-11-12',
    email_opted_out_at: null,
    vetted: true,
    vetted_at: '2026-11-12T00:00:00.000Z',
    vetting_evidence: 'Supplier reference checked',
  };
  assert.equal(maySendSubconOutreach(consent), true);
  assert.equal(maySendSubconOutreach({ ...consent, email_opted_out_at: '2026-11-12T01:00:00.000Z' }), false);
  assert.equal(maySendSubconOutreach({ ...consent, active: false }), false);
  assert.equal(maySendSubconOutreach({ ...consent, email_opt_in_evidence: null }), false);
  assert.equal(maySendSubconOutreach({ ...consent, vetted: false }), false);
  assert.equal(maySendSubconOutreach({ ...consent, vetting_evidence: null }), false);
});
