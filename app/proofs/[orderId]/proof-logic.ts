export type ProofProductionStatus =
  | 'PENDING_CLIENT_APPROVAL'
  | 'READY_FOR_FINAL_CHECK'
  | 'FINAL_CHECK_PENDING'
  | 'MASS_CUTTING_AND_EMBROIDERY';

export interface ProofApprovalInput {
  orderId: string;
  clientName?: string;
  itemName?: string;
  digitalLayoutApproved?: boolean;
  mockupApproved?: boolean;
  dstPreviewApproved?: boolean;
  comments?: string;
  finalCheckApproved?: boolean;
}

export interface ProofApprovalState {
  orderId: string;
  clientName: string;
  itemName: string;
  digitalLayoutApproved: boolean;
  mockupApproved: boolean;
  dstPreviewApproved: boolean;
  finalCheckApproved: boolean;
  comments: string;
  approvalCount: number;
  totalChecks: number;
  approvalPercent: number;
  productionStatus: ProofProductionStatus;
}

export function buildProofApprovalState(input: ProofApprovalInput): ProofApprovalState {
  const digitalLayoutApproved = Boolean(input.digitalLayoutApproved);
  const mockupApproved = Boolean(input.mockupApproved);
  const dstPreviewApproved = Boolean(input.dstPreviewApproved);
  const finalCheckApproved = Boolean(input.finalCheckApproved);

  const approvalCount = [digitalLayoutApproved, mockupApproved, dstPreviewApproved, finalCheckApproved].filter(Boolean).length;
  const totalChecks = 4;
  const approvalPercent = Math.round((approvalCount / totalChecks) * 100);

  const allProofStagesApproved = digitalLayoutApproved && mockupApproved && dstPreviewApproved;
  let productionStatus: ProofProductionStatus = 'PENDING_CLIENT_APPROVAL';

  if (allProofStagesApproved && finalCheckApproved) {
    productionStatus = 'MASS_CUTTING_AND_EMBROIDERY';
  } else if (allProofStagesApproved) {
    productionStatus = 'READY_FOR_FINAL_CHECK';
  }

  return {
    orderId: input.orderId,
    clientName: input.clientName || 'Client',
    itemName: input.itemName || 'Custom apparel project',
    digitalLayoutApproved,
    mockupApproved,
    dstPreviewApproved,
    finalCheckApproved,
    comments: input.comments || '',
    approvalCount,
    totalChecks,
    approvalPercent,
    productionStatus,
  };
}

export function formatApprovalStatus(status: ProofProductionStatus | string) {
  switch (status) {
    case 'PENDING_CLIENT_APPROVAL':
      return 'Pending client approval';
    case 'READY_FOR_FINAL_CHECK':
      return 'Ready for final check';
    case 'FINAL_CHECK_PENDING':
      return 'Final check pending';
    case 'MASS_CUTTING_AND_EMBROIDERY':
      return 'Mass cutting and embroidery ready';
    default:
      return 'Pending client approval';
  }
}
