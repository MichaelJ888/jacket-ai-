import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseMessage, isReleaseLive, parseAnnouncedIds, pendingReleases, type ReleaseNote } from './release-announcements-logic.ts';

const registry: ReleaseNote[] = [
  { id: 'new', title: 'Bago', items: ['Feature <A>'] },
  { id: 'old', title: 'Luma', items: ['Lumang feature'] },
];

test('only releases not yet announced are pending, in registry order', () => {
  assert.deepEqual(pendingReleases(registry, ['old']).map((release) => release.id), ['new']);
  assert.deepEqual(pendingReleases(registry, ['new', 'old']), []);
  assert.deepEqual(pendingReleases(registry, []).map((release) => release.id), ['new', 'old']);
});

test('a deployment is live for a release only when its registry head matches', () => {
  assert.equal(isReleaseLive('new', registry), true);
  assert.equal(isReleaseLive('old', registry), false);
  assert.equal(isReleaseLive('new', []), false);
});

test('announced ids parse safely from ceo_settings text', () => {
  assert.deepEqual(parseAnnouncedIds('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseAnnouncedIds(null), []);
  assert.deepEqual(parseAnnouncedIds('not json'), []);
  assert.deepEqual(parseAnnouncedIds('{"a":1}'), []);
});

test('release message is escaped and lists each item', () => {
  const text = buildReleaseMessage(registry[0]);
  assert.equal(text, '🚀 <b>BAGONG UPDATE: Bago</b>\n• Feature &lt;A&gt;');
});
