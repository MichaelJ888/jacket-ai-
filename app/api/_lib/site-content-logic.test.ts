import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkEditorPassword,
  generateOtp,
  hashOtp,
  isEditorChatAllowed,
  readCookie,
  sanitizeSiteDoc,
  signEditorSession,
  verifyEditorSession,
} from './site-content-logic.ts';

const PASSWORD = 'test-password';

test('sanitizeSiteDoc accepts a valid document and normalises colours', () => {
  const result = sanitizeSiteDoc({
    theme: { primary: '#0b1e3d' },
    texts: { 'hero.title': 'Hello' },
    images: { 'card-1': 'https://cdn.example.com/a.png', 'card-2': '/images/b.png' },
    catalogOrder: ['Varsity', 'Bomber'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.doc.theme.primary, '#0B1E3D');
  assert.equal(result.doc.theme.secondary, '#B8912F');
  assert.deepEqual(result.doc.catalogOrder, ['Varsity', 'Bomber']);
});

test('sanitizeSiteDoc rejects non-hex colours', () => {
  assert.equal(sanitizeSiteDoc({ theme: { primary: 'red' } }).ok, false);
  assert.equal(sanitizeSiteDoc({ theme: { background: '#fff' } }).ok, false);
});

test('sanitizeSiteDoc rejects unsafe image URLs', () => {
  for (const url of ['javascript:alert(1)', 'http://insecure.example.com/a.png', '//evil.example.com/a.png', 'https://x.example.com/a"onerror=1']) {
    assert.equal(sanitizeSiteDoc({ images: { k: url } }).ok, false, url);
  }
});

test('sanitizeSiteDoc rejects non-object input and oversized text', () => {
  assert.equal(sanitizeSiteDoc(null).ok, false);
  assert.equal(sanitizeSiteDoc('x').ok, false);
  assert.equal(sanitizeSiteDoc({ texts: { k: 'x'.repeat(2001) } }).ok, false);
});

test('isEditorChatAllowed allows only the CEO and Anne Manalo', () => {
  assert.equal(isEditorChatAllowed('7329264426', '111'), true);
  assert.equal(isEditorChatAllowed('111', '111'), true);
  assert.equal(isEditorChatAllowed('999', '111'), false);
  assert.equal(isEditorChatAllowed('7329264426', undefined), true);
  assert.equal(isEditorChatAllowed('', undefined), false);
});

test('checkEditorPassword is exact and fails closed when unset', () => {
  assert.equal(checkEditorPassword(PASSWORD, PASSWORD), true);
  assert.equal(checkEditorPassword('test-passwor', PASSWORD), false);
  assert.equal(checkEditorPassword(PASSWORD, undefined), false);
});

test('generateOtp returns a 6-digit code', () => {
  for (let i = 0; i < 50; i += 1) assert.match(generateOtp(), /^\d{6}$/);
});

test('hashOtp is bound to chat ID and password', () => {
  const base = hashOtp('123456', '111', PASSWORD);
  assert.equal(base, hashOtp('123456', '111', PASSWORD));
  assert.notEqual(base, hashOtp('123456', '222', PASSWORD));
  assert.notEqual(base, hashOtp('123457', '111', PASSWORD));
  assert.notEqual(base, hashOtp('123456', '111', 'other'));
});

test('editor session round-trips and rejects tampering, expiry and wrong password', () => {
  const now = Date.now();
  const token = signEditorSession('7329264426', now + 60_000, PASSWORD);
  assert.equal(verifyEditorSession(token, PASSWORD, now), '7329264426');
  assert.equal(verifyEditorSession(token, 'wrong', now), null);
  assert.equal(verifyEditorSession(token, PASSWORD, now + 120_000), null);
  assert.equal(verifyEditorSession(token.replace('7329264426', '1'), PASSWORD, now), null);
  assert.equal(verifyEditorSession(undefined, PASSWORD, now), null);
  assert.equal(verifyEditorSession(token, undefined, now), null);
});

test('readCookie finds a named cookie among several', () => {
  assert.equal(readCookie('a=1; mjic_editor=abc.def; b=2', 'mjic_editor'), 'abc.def');
  assert.equal(readCookie('a=1', 'mjic_editor'), undefined);
  assert.equal(readCookie(null, 'mjic_editor'), undefined);
});
