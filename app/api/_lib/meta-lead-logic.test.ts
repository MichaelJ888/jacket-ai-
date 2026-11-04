import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLeadgenFieldData } from './meta-lead-logic.ts';

test('parses standard Meta leadgen fields into contact + context message', () => {
  const parsed = parseLeadgenFieldData([
    { name: 'full_name', values: ['Juan Dela Cruz'] },
    { name: 'phone_number', values: ['+639201234567'] },
    { name: 'email', values: ['juan@example.com'] },
    { name: 'company_name', values: ['Acme Corp'] },
    { name: 'how_many_pieces?', values: ['200'] },
  ]);
  assert.equal(parsed.name, 'Juan Dela Cruz');
  assert.equal(parsed.phone, '+639201234567');
  assert.equal(parsed.email, 'juan@example.com');
  assert.equal(parsed.company, 'Acme Corp');
  assert.equal(parsed.contact, '+639201234567', 'phone wins over email');
  assert.ok(parsed.message.includes('how_many_pieces?: 200'), 'custom questions stay in the context message');
});

test('handles missing/custom-only field data without throwing', () => {
  const parsed = parseLeadgenFieldData([{ name: 'notes', values: ['Need lanyards'] }]);
  assert.equal(parsed.name, '');
  assert.equal(parsed.contact, '');
  assert.ok(parsed.message.includes('Need lanyards'));
  assert.deepEqual(parseLeadgenFieldData(undefined), { name: '', company: '', phone: '', email: '', contact: '', message: '' });
  assert.deepEqual(parseLeadgenFieldData('garbage'), { name: '', company: '', phone: '', email: '', contact: '', message: '' });
});

test('email becomes the contact when no phone was given', () => {
  const parsed = parseLeadgenFieldData([{ name: 'email', values: ['a@b.com'] }]);
  assert.equal(parsed.contact, 'a@b.com');
});
