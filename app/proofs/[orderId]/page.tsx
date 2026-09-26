"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { buildProofApprovalState, formatApprovalStatus } from "./proof-logic";

const defaultProof = {
  orderId: "SO-1001",
  clientName: "Maria Santos",
  itemName: "Corporate Jacket",
  digitalLayoutApproved: false,
  mockupApproved: false,
  dstPreviewApproved: false,
  finalCheckApproved: false,
  comments: "Please review the fit, placement, and embroidery details before sample production.",
};

function StepCard({
  title,
  description,
  approved,
  onToggle,
}: {
  title: string;
  description: string;
  approved: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        border: approved ? "1px solid #16a34a" : "1px solid #d4d4d8",
        background: approved ? "rgba(22, 163, 74, 0.08)" : "#fff",
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          <div style={{ color: "#52525b", marginTop: 6 }}>{description}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          style={{
            border: "none",
            background: approved ? "#16a34a" : "#e4e4e7",
            color: approved ? "#fff" : "#18181b",
            fontWeight: 700,
            padding: "10px 14px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {approved ? "Approved" : "Approve"}
        </button>
      </div>
    </div>
  );
}

export default function ProofApprovalPage() {
  const params = useParams<{ orderId?: string }>();
  const orderId = params?.orderId || defaultProof.orderId;

  const [approvals, setApprovals] = useState({
    digitalLayoutApproved: defaultProof.digitalLayoutApproved,
    mockupApproved: defaultProof.mockupApproved,
    dstPreviewApproved: defaultProof.dstPreviewApproved,
    finalCheckApproved: defaultProof.finalCheckApproved,
  });
  const [comments, setComments] = useState(defaultProof.comments);
  const [statusText, setStatusText] = useState("Pending client review");
  const [submitting, setSubmitting] = useState(false);

  const state = useMemo(
    () =>
      buildProofApprovalState({
        orderId,
        clientName: defaultProof.clientName,
        itemName: defaultProof.itemName,
        ...approvals,
        comments,
      }),
    [approvals, comments, orderId],
  );

  const updateApproval = (key: keyof typeof approvals) => {
    setApprovals((current) => ({ ...current, [key]: !current[key] }));
  };

  const submitApproval = async () => {
    setSubmitting(true);
    setStatusText("Submitting approval...");

    try {
      const response = await fetch(`/api/proofs/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          clientName: defaultProof.clientName,
          itemName: defaultProof.itemName,
          digitalLayoutApproved: approvals.digitalLayoutApproved,
          mockupApproved: approvals.mockupApproved,
          dstPreviewApproved: approvals.dstPreviewApproved,
          finalCheckApproved: approvals.finalCheckApproved,
          comments,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Approval request failed." }));
        throw new Error(payload.error || "Approval request failed.");
      }

      const payload = await response.json();
      setStatusText(formatApprovalStatus(payload.productionStatus));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unable to submit approval.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
        padding: "40px 20px",
        color: "#18181b",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ letterSpacing: 2, textTransform: "uppercase", color: "#4f46e5", fontWeight: 700, fontSize: 12 }}>
              MJIC client proof portal
            </div>
            <h1 style={{ margin: "8px 0 0", fontSize: 36 }}>Sample & design approval</h1>
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: "10px 18px",
              background: state.productionStatus === "MASS_CUTTING_AND_EMBROIDERY" ? "#dcfce7" : "#fef3c7",
              color: state.productionStatus === "MASS_CUTTING_AND_EMBROIDERY" ? "#166534" : "#92400e",
              fontWeight: 700,
            }}
          >
            {formatApprovalStatus(state.productionStatus)}
          </div>
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 18,
            marginBottom: 28,
          }}
        >
          {[
            { label: "Order ID", value: orderId },
            { label: "Client", value: defaultProof.clientName },
            { label: "Item", value: defaultProof.itemName },
            { label: "Approval progress", value: `${state.approvalPercent}%` },
          ].map((item) => (
            <div key={item.label} style={{ background: "#fff", borderRadius: 16, padding: 18, border: "1px solid #e4e4e7" }}>
              <div style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", letterSpacing: 1.2 }}>{item.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{item.value}</div>
            </div>
          ))}
        </section>

        <section
          style={{
            background: "#fff",
            border: "1px solid #e4e4e7",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.05)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 20px" }}>Review checklist</h2>
              <div style={{ display: "grid", gap: 16 }}>
                <StepCard
                  title="Digital layout"
                  description="Review placement, front/back layout, logo sizing, and print/embroidery position."
                  approved={approvals.digitalLayoutApproved}
                  onToggle={() => updateApproval("digitalLayoutApproved")}
                />
                <StepCard
                  title="3D jacket mockup"
                  description="Check silhouette, color balance, zipper and pocket finish, and overall fit."
                  approved={approvals.mockupApproved}
                  onToggle={() => updateApproval("mockupApproved")}
                />
                <StepCard
                  title="DST embroidery stitch preview"
                  description="Confirm stitch density, thread count, and logo geometry before sample build."
                  approved={approvals.dstPreviewApproved}
                  onToggle={() => updateApproval("dstPreviewApproved")}
                />
                <StepCard
                  title="Final production check"
                  description="Final internal sign-off before mass cutting and embroidery starts."
                  approved={approvals.finalCheckApproved}
                  onToggle={() => updateApproval("finalCheckApproved")}
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ background: "#f8fafc", borderRadius: 18, border: "1px solid #e4e4e7", padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 12 }}>Preview gallery</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ background: "linear-gradient(135deg, #dbeafe 0%, #f5f3ff 100%)", borderRadius: 16, height: 110, display: "grid", placeItems: "center", fontWeight: 700 }}>Digital layout</div>
                  <div style={{ background: "linear-gradient(135deg, #dcfce7 0%, #ecfeff 100%)", borderRadius: 16, height: 110, display: "grid", placeItems: "center", fontWeight: 700 }}>3D mockup</div>
                  <div style={{ background: "linear-gradient(135deg, #fef3c7 0%, #fdf2f8 100%)", borderRadius: 16, height: 110, display: "grid", placeItems: "center", fontWeight: 700 }}>DST stitch preview</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", borderRadius: 18, border: "1px solid #e4e4e7", padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 12 }}>Client comments</div>
                <textarea
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  rows={5}
                  style={{ width: "100%", resize: "vertical", borderRadius: 12, border: "1px solid #d4d4d8", padding: 12, font: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button
                  type="button"
                  onClick={submitApproval}
                  disabled={submitting}
                  style={{
                    background: "#111827",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "14px 18px",
                    fontWeight: 700,
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? "Submitting..." : "Approve and continue"}
                </button>
                <div style={{ color: "#4b5563", fontSize: 14 }}>{statusText}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
