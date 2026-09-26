import { NextResponse } from "next/server";

import { buildProofApprovalState } from "../../../proofs/[orderId]/proof-logic";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const state = buildProofApprovalState({
    orderId,
    clientName: "Maria Santos",
    itemName: "Corporate Jacket",
    digitalLayoutApproved: false,
    mockupApproved: false,
    dstPreviewApproved: false,
    finalCheckApproved: false,
    comments: "Awaiting client approvals before sample production.",
  });

  return NextResponse.json(state);
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const body = await request.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const state = buildProofApprovalState({
    orderId,
    clientName: body.clientName || "Client",
    itemName: body.itemName || "Custom apparel project",
    digitalLayoutApproved: Boolean(body.digitalLayoutApproved),
    mockupApproved: Boolean(body.mockupApproved),
    dstPreviewApproved: Boolean(body.dstPreviewApproved),
    finalCheckApproved: Boolean(body.finalCheckApproved),
    comments: String(body.comments || ""),
  });

  return NextResponse.json(state);
}
