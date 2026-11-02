import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIdentityKeys, dedupeClientRecords, normalizeClientName, normalizePhoneKey } from './client-identity-logic.ts';

test('client names normalize case, accents, punctuation and legal suffixes', () => {
  assert.equal(normalizeClientName('  Metro Logistics, Inc. '), 'metro logistics');
  assert.equal(normalizeClientName('Smart & Globe'), 'smart and globe');
  assert.equal(normalizeClientName('Peña Corp'), 'pena');
});

test('phone formats collapse to the same 10-digit identity', () => {
  assert.equal(normalizePhoneKey('+63 917 123 4567'), '09171234567');
  assert.equal(normalizePhoneKey('0917-123-4567'), '09171234567');
  assert.equal(normalizePhoneKey('9171234567'), '09171234567');
  assert.equal(normalizePhoneKey('12'), '');
});

test('same client across name, company or phone is kept once', () => {
  const { unique, duplicates } = dedupeClientRecords([
    { clientName: 'Juan Dela Cruz', phone: '0917 123 4567' },
    { clientName: 'JUAN DELA CRUZ', phone: null },
    { clientName: 'Maria Santos', company: 'Panasonic Inc.' },
    { clientName: 'M. Santos', company: 'panasonic' },
    { clientName: 'Ana', phone: '+639171234567' },
  ]);
  assert.deepEqual(unique.map((c) => c.clientName), ['Juan Dela Cruz', 'Maria Santos']);
  assert.deepEqual(duplicates.map((c) => c.clientName), ['JUAN DELA CRUZ', 'M. Santos', 'Ana']);
});

test('records with no identifiers are never dropped', () => {
  const { unique, duplicates } = dedupeClientRecords([{ clientName: '' }, { clientName: '' }]);
  assert.equal(unique.length, 2);
  assert.equal(duplicates.length, 0);
  assert.deepEqual(clientIdentityKeys({ clientName: '' }), []);
});
