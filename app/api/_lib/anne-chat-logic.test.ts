import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnneFirstNameSender, isMsAnneSender } from './anne-chat-logic.ts';

test('matches a first name "Anne" posted in the CEO group, case-insensitive', () => {
  assert.equal(isAnneFirstNameSender({ first_name: 'Anne' }), true);
  assert.equal(isAnneFirstNameSender({ first_name: ' anne ', last_name: 'Cruz' }), true);
  assert.equal(isAnneFirstNameSender({ first_name: 'Joanne' }), false);
  assert.equal(isAnneFirstNameSender({ first_name: 'Juan' }), false);
  assert.equal(isAnneFirstNameSender(undefined), false);
});

test('matches the exact full name "Anne Manalo", case-insensitive', () => {
  assert.equal(isMsAnneSender({ first_name: 'Anne', last_name: 'Manalo' }), true);
  assert.equal(isMsAnneSender({ first_name: 'anne', last_name: 'MANALO' }), true);
  assert.equal(isMsAnneSender({ first_name: '  Anne  Manalo ' }), true);
});

test('does not match partial names, usernames, or unrelated senders', () => {
  assert.equal(isMsAnneSender({ first_name: 'Anne', last_name: 'Cruz' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Anne', username: 'anne_manalo' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Anne' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Manalo' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Juan', last_name: 'Manalo' }), false);
  assert.equal(isMsAnneSender({ first_name: 'Juan' }), false);
  assert.equal(isMsAnneSender(undefined), false);
  assert.equal(isMsAnneSender(null), false);
});
