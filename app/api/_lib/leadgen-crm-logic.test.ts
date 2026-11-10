import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isMjicLeadgenPage, leadgenContactInput, leadgenExternalId } from './leadgen-crm-logic.ts';

test('accepts leadgen only for the configured MJIC Meta Page', () => {
  assert.equal(isMjicLeadgenPage('mjic-page', 'mjic-page'), true);
  assert.equal(isMjicLeadgenPage('cgv-page', 'mjic-page'), false);
  assert.equal(isMjicLeadgenPage(undefined, 'mjic-page'), false);
  assert.equal(isMjicLeadgenPage('mjic-page', undefined), false);
});

test('leadgenExternalId is stable per leadgen id', () => {
  assert.equal(leadgenExternalId('123'), 'leadgen:123');
});

test('maps a lead-ad row to a facebook contact keyed by leadgen id', () => {
  const input = leadgenContactInput({
    name: 'Juan',
    contact: '09171234567',
    details: { leadgenId: '42', pageId: 'p1', email: null, phone: '09171234567' },
  });
  assert.deepEqual(input, { channel: 'facebook', externalId: 'leadgen:42', name: 'Juan', phone: '09171234567', email: undefined, pageId: 'p1' });
});

test('uses an email-looking contact when details has no email', () => {
  const input = leadgenContactInput({ name: 'Ana', contact: 'ana@example.com', details: { leadgenId: '7' } });
  assert.equal(input?.email, 'ana@example.com');
  assert.equal(input?.phone, undefined);
});

test('ignores the placeholder name and rows without a leadgen id', () => {
  assert.equal(leadgenContactInput({ name: 'Facebook lead', details: { leadgenId: '9' } })?.name, undefined);
  assert.equal(leadgenContactInput({ name: 'Web lead', contact: '0917', details: { source: 'website' } }), null);
  assert.equal(leadgenContactInput({ name: 'x', details: null }), null);
});
