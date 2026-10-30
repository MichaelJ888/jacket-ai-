import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFundLockAlert } from './fund-lock-alert-logic.ts';
import { buildMessengerLink, csvToTable, fillOptionalColumns, jsonRowsToTable, SUBCON_IMPORT_COLUMNS, SUBCON_IMPORT_KEY } from './subcon-import-logic.ts';
import { planImport } from './csv-import-logic.ts';

test('fund lock is red when cash cannot cover locked funds', () => {
  const alert = evaluateFundLockAlert({ cashBalance: 5000, lockedTotal: 8000 });
  assert.equal(alert.level, 'red');
  assert.equal(alert.shortfall, 3000);
});

test('fund lock is green when cash covers the lock', () => {
  assert.equal(evaluateFundLockAlert({ cashBalance: 8000, lockedTotal: 8000 }).level, 'green');
});

test('fund lock is unknown when cash balance is unavailable', () => {
  assert.equal(evaluateFundLockAlert({ cashBalance: null, lockedTotal: 100 }).level, 'unknown');
});

test('m.me links accept usernames, ids, and existing m.me URLs', () => {
  assert.equal(buildMessengerLink('@mjic.tahian'), 'https://m.me/mjic.tahian');
  assert.equal(buildMessengerLink('100012345678901'), 'https://m.me/100012345678901');
  assert.equal(buildMessengerLink('https://www.m.me/sewer_jo/'), 'https://m.me/sewer_jo');
  assert.equal(buildMessengerLink(''), null);
  assert.equal(buildMessengerLink('bad handle!'), null);
});

test('CSV subcon import plans inserts and updates against the directory', () => {
  const csv = 'name,specialty,daily_capacity_pcs,rate_per_pc,messenger_handle\nAling Rosa,Sewer,40,25,rosa.sewer\nMang Ben,Cutter,,,\n';
  const { header, rows } = fillOptionalColumns(csvToTable(csv));
  const existing = { 'Aling Rosa': { name: 'Aling Rosa', specialty: 'Sewer', daily_capacity_pcs: '40', rate_per_pc: '20', messenger_handle: '', notes: '', contact_phone: '', location: '' } };
  const result = planImport(header, rows, SUBCON_IMPORT_COLUMNS, SUBCON_IMPORT_KEY, existing);
  assert.equal(result.ok, true);
  assert.equal(result.counts.insert, 1);
  assert.equal(result.counts.update, 1);
});

test('JSON subcon import flattens an array of objects', () => {
  const table = jsonRowsToTable([{ name: 'Aling Rosa', daily_capacity_pcs: 40 }, { name: 'Mang Ben', notes: null }]);
  assert.deepEqual(table?.header, ['name', 'daily_capacity_pcs', 'notes']);
  assert.deepEqual(table?.rows[1], ['Mang Ben', '', '']);
  assert.equal(jsonRowsToTable({ name: 'not an array' }), null);
});
