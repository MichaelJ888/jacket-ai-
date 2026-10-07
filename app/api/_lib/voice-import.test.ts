import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQaText } from './voice-import.ts';

test('parses Client/Me transcripts into pairs', () => {
  const rows = parseQaText('Client: magkano po jacket?\nMe: Sir 850 po each, minimum 20 pcs.\nPo sir.\n\nClient: pwede 10 lang?\nMe: Pwede po sample.');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].prompt, 'magkano po jacket?');
  assert.equal(rows[0].reply, 'Sir 850 po each, minimum 20 pcs.\nPo sir.');
});

test('falls back to blank-line blocks without markers', () => {
  const rows = parseQaText('Hello po sir\n\nSalamat po');
  assert.deepEqual(rows.map((row) => row.reply), ['Hello po sir', 'Salamat po']);
});
