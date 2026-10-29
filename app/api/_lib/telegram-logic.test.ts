import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_VOICE_SECONDS, isFreshUpdateInsertError, normalizeAudioType, pickTelegramMedia } from './telegram-logic.ts';

test('voice notes are accepted and normalized', () => {
  const { media } = pickTelegramMedia({ voice: { file_id: 'v1', mime_type: 'audio/ogg', file_size: 5000, duration: 12 } });
  assert.equal(media?.kind, 'voice');
  assert.equal(media?.mediaType, 'audio/ogg');
  assert.equal(normalizeAudioType(undefined), 'audio/ogg');
  assert.equal(normalizeAudioType('audio/mpeg'), 'audio/mpeg');
});

test('overlong or oversized voice is rejected with a reason', () => {
  const long = pickTelegramMedia({ voice: { file_id: 'v1', duration: MAX_VOICE_SECONDS + 1 } });
  assert.equal(long.media, null);
  assert.ok(long.rejected);
  assert.ok(pickTelegramMedia({ audio: { file_id: 'a', file_size: 50_000_000, duration: 10 } }).rejected);
});

test('largest photo under the size cap is chosen', () => {
  const { media } = pickTelegramMedia({ photo: [{ file_id: 's', width: 90, height: 90, file_size: 1000 }, { file_id: 'm', width: 800, height: 800, file_size: 90000 }, { file_id: 'huge', width: 4000, height: 4000, file_size: 20_000_000 }] });
  assert.equal(media?.fileId, 'm');
});

test('only image documents are accepted', () => {
  assert.equal(pickTelegramMedia({ document: { file_id: 'd', mime_type: 'image/png', file_size: 100 } }).media?.kind, 'image-file');
  assert.equal(pickTelegramMedia({ document: { file_id: 'd', mime_type: 'image/JPG', file_size: 100 } }).media?.mediaType, 'image/jpeg');
  assert.equal(pickTelegramMedia({ document: { file_id: 'd', mime_type: 'image/heic', file_size: 100 } }).media?.kind, 'image-file');
  assert.equal(pickTelegramMedia({ document: { file_id: 'd', mime_type: 'application/x-msdownload', file_size: 100 } }).media, null);
  assert.equal(pickTelegramMedia({}).media, null);
  assert.equal(pickTelegramMedia(null).media, null);
});

test('duplicate update_id (unique violation) is detected, other errors fail open', () => {
  assert.equal(isFreshUpdateInsertError(null), true);
  assert.equal(isFreshUpdateInsertError({ code: '23505' }), false);
  assert.equal(isFreshUpdateInsertError({ code: '08006' }), true);
});
