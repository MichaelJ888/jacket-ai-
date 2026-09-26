import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProofApprovalState, formatApprovalStatus } from './proof-logic';

test('buildProofApprovalState marks production-ready after all proof stages are approved and the final check is signed off', () => {
  const state = buildProofApprovalState({
    orderId: 'SO-1001',
    clientName: 'Maria Santos',
    itemName: 'Corporate Jacket',
    digitalLayoutApproved: true,
    mockupApproved: true,
    dstPreviewApproved: true,
    finalCheckApproved: true,
    comments: 'Looks good. Proceed with production.',
  });

  assert.equal(state.orderId, 'SO-1001');
  assert.equal(state.productionStatus, 'MASS_CUTTING_AND_EMBROIDERY');
  assert.equal(formatApprovalStatus(state.productionStatus), 'Mass cutting and embroidery ready');
});

test('buildProofApprovalState keeps pending status until all proof stages are approved', () => {
  const state = buildProofApprovalState({
    orderId: 'SO-1002',
    clientName: 'Nina Reyes',
    itemName: 'School Uniform',
    digitalLayoutApproved: true,
    mockupApproved: false,
    dstPreviewApproved: false,
  });

  assert.equal(state.productionStatus, 'PENDING_CLIENT_APPROVAL');
  assert.equal(formatApprovalStatus(state.productionStatus), 'Pending client approval');
});

test('buildProofApprovalState flags the final production gate once all proof stages are approved', () => {
  const state = buildProofApprovalState({
    orderId: 'SO-1003',
    clientName: 'Anton Cruz',
    itemName: 'Polo Uniform',
    digitalLayoutApproved: true,
    mockupApproved: true,
    dstPreviewApproved: true,
    finalCheckApproved: false,
  });

  assert.equal(state.productionStatus, 'READY_FOR_FINAL_CHECK');
  assert.equal(formatApprovalStatus(state.productionStatus), 'Ready for final check');
});
