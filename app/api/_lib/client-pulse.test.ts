import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClientPulseMessage, buildOrderPulseMessage, parseMoveInput, parseOrderInput, resolveStageInput, sortOrdersForPulse, type OpenOrder } from './client-pulse.ts';
import { ORDER_STAGES, PIPELINE_STAGES, stageNumber } from './order-stages.ts';

test('resolveStageInput accepts aliases and canonical names', () => {
  assert.equal(resolveStageInput('sewing'), 'S08_PRODUCTION');
  assert.equal(resolveStageInput('qc'), 'S09_QC');
  assert.equal(resolveStageInput('paid'), 'S10_BALANCE');
  assert.equal(resolveStageInput('dp'), 'S05_DEPOSIT');
  assert.equal(resolveStageInput('READY'), 'S11_DISPATCH');
  assert.equal(resolveStageInput('done'), 'COMPLETED');
  assert.equal(resolveStageInput('hold'), 'ON_HOLD');
  assert.equal(resolveStageInput('bogus'), null);
});

test('parseOrderInput parses pipe-separated client/project/total', () => {
  assert.deepEqual(parseOrderInput('Juan Dela Cruz | 50pcs school uniforms | 15000'), {
    clientName: 'Juan Dela Cruz',
    projectName: '50pcs school uniforms',
    totalAmount: 15000,
  });
  assert.deepEqual(parseOrderInput('Juan'), { clientName: 'Juan', projectName: null, totalAmount: 0 });
  assert.ok('error' in parseOrderInput(''));
  assert.ok('error' in parseOrderInput('Juan | project | labo'));
});

test('parseMoveInput uses the last word as the stage', () => {
  assert.deepEqual(parseMoveInput('Juan Dela Cruz sewing'), { ref: 'Juan Dela Cruz', stage: 'S08_PRODUCTION' });
  assert.deepEqual(parseMoveInput('ORD-12345678 done'), { ref: 'ORD-12345678', stage: 'COMPLETED' });
  assert.ok('error' in parseMoveInput('Juan'));
  assert.ok('error' in parseMoveInput('Juan bogus'));
});

test('buildClientPulseMessage lists next actions and flags stale orders', () => {
  const now = new Date('2026-10-28T06:00:00+08:00');
  const orders: OpenOrder[] = [
    { id: '1', order_number: 'ORD-1', client_name: 'Juan', project_name: 'uniforms', quantity: 50, total_amount: 15000, stage: 'S08_PRODUCTION', updated_at: '2026-10-24T00:00:00+08:00', created_at: null },
    { id: '2', order_number: 'ORD-2', client_name: 'Maria', project_name: null, quantity: null, total_amount: 0, stage: 'S05_DEPOSIT', updated_at: '2026-10-28T05:00:00+08:00', created_at: null },
  ];
  const message = buildClientPulseMessage(orders, now);
  assert.match(message, /CLIENT PULSE/);
  assert.match(message, /Juan/);
  assert.match(message, /Stage 08\/11/);
  assert.match(message, /4 araw na/); // stale flag
  assert.match(message, /D\.P\./);
  assert.match(message, /MOVE &lt;client&gt; &lt;stage&gt;/);
  assert.match(buildClientPulseMessage([], now), /Walang open orders/);
});

test('buildOrderPulseMessage is one message per client with 11-stage progress + next step', () => {
  const now = new Date('2026-10-29T06:00:00+08:00');
  const order: OpenOrder = { id: '1', order_number: 'ORD-12345678', client_name: 'Max', project_name: 'Jackets', quantity: 50, total_amount: 25000, stage: 'S02_SOURCING', updated_at: '2026-10-28T06:00:00+08:00', created_at: null };
  const message = buildOrderPulseMessage(order, 0, 3, now);
  assert.match(message, /1\/3 · Max/);
  assert.match(message, /Stage 02\/11 · Fabric/);
  assert.match(message, /👉/); // next step
  assert.match(message, /ORD-12345678/); // update hint references order number
});

test('sortOrdersForPulse orders by pipeline stage, ON_HOLD last', () => {
  const base = { order_number: 'X', client_name: 'C', project_name: null, quantity: null, total_amount: 0, updated_at: null, created_at: null };
  const orders: OpenOrder[] = [
    { ...base, id: '1', stage: 'S08_PRODUCTION' },
    { ...base, id: '2', stage: 'ON_HOLD' },
    { ...base, id: '3', stage: 'S05_DEPOSIT' },
  ];
  assert.deepEqual(sortOrdersForPulse(orders).map((o) => o.stage), ['S05_DEPOSIT', 'S08_PRODUCTION', 'ON_HOLD']);
});

test('stageNumber maps pipeline keys to 1-11 and everything else to 0', () => {
  assert.equal(PIPELINE_STAGES.length, 11);
  assert.equal(ORDER_STAGES.length, 11);
  assert.equal(stageNumber('S01_INQUIRY'), 1);
  assert.equal(stageNumber('S11_DISPATCH'), 11);
  assert.equal(stageNumber('ON_HOLD'), 0);
});
