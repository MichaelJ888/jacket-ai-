import test from 'node:test';
import assert from 'node:assert/strict';
import { isMsAnneSender } from './anne-chat-logic.ts';

test('matches Ms. Anne Manalo by last name or username', () => {
  assert.equal(isMsAnneSender({ first_name: 'Anne', last_name: 'Manalo' }), true);
  assert.equal(isMsAnneSender({ first_name: 'Anne', username: 'anne_manalo' }), true);
  assert.equal(isMsAnneSender({ first_name: 'ANNE MANALO' }), true);
});

test('does not match unrelated senders, even when first name is Anne', () => {
  assert.equal(isMsAnneSender({ first_name: 'Anne', last_name: 'Cruz' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Juan' }), false);
  assert.equal(isMsAnneSender(undefined), false);
  assert.equal(isMsAnneSender(null), false);
});
