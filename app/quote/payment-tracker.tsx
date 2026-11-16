'use client';

import { useState } from 'react';

export interface PaymentReconciliation {
  orderReference: string;
  depositAmount: number;
  depositDue: string; // ISO date
  paymentStatus: 'pending' | 'submitted' | 'verified' | 'failed';
  paymentSlipUrl?: string;
  submittedAt?: string;
  verifiedAt?: string;
  verificationNote?: string;
}

export function PaymentTracker({ reconciliation }: { reconciliation: PaymentReconciliation }) {
  const [submittingSlip, setSubmittingSlip] = useState(false);
  const [slipError, setSlipError] = useState('');

  const statusColor = {
    pending: 'bg-amber-50 border-amber-200 text-amber-900',
    submitted: 'bg-blue-50 border-blue-200 text-blue-900',
    verified: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    failed: 'bg-red-50 border-red-200 text-red-900',
  };

  const statusLabel = {
    pending: '⏳ Awaiting Deposit',
    submitted: '📋 Payment Slip Submitted',
    verified: '✅ Payment Confirmed',
    failed: '❌ Payment Verification Failed',
  };

  async function handleSlipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipError('');
    setSubmittingSlip(true);

    try {
      const formData = new FormData();
      formData.append('orderReference', reconciliation.orderReference);
      formData.append('paymentSlip', file);

      const res = await fetch('/api/quote/payment-verification', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setSlipError(data.message || 'Could not upload payment slip.');
        return;
      }

      // Optionally refresh the parent or show success
      window.location.reload();
    } catch {
      setSlipError('Network error. Please try again.');
    } finally {
      setSubmittingSlip(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Payment Status</h3>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusColor[reconciliation.paymentStatus]}`}>
          {statusLabel[reconciliation.paymentStatus]}
        </span>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Order Reference</dt>
          <dd className="font-mono font-semibold">{reconciliation.orderReference}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Deposit Amount</dt>
          <dd className="font-semibold">₱{Math.round(reconciliation.depositAmount).toLocaleString('en-US')}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Due By</dt>
          <dd>{new Date(reconciliation.depositDue).toLocaleDateString('en-PH')}</dd>
        </div>
        {reconciliation.submittedAt && (
          <div className="flex justify-between pt-2 border-t border-slate-200">
            <dt className="text-slate-600">Slip Submitted</dt>
            <dd>{new Date(reconciliation.submittedAt).toLocaleDateString('en-PH')}</dd>
          </div>
        )}
        {reconciliation.verifiedAt && (
          <div className="flex justify-between">
            <dt className="text-slate-600">Verified</dt>
            <dd>{new Date(reconciliation.verifiedAt).toLocaleDateString('en-PH')}</dd>
          </div>
        )}
        {reconciliation.verificationNote && (
          <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
            {reconciliation.verificationNote}
          </div>
        )}
      </dl>

      {reconciliation.paymentStatus === 'pending' && (
        <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Ready to send proof of payment?</p>
          <p className="mt-1 text-xs text-amber-800">Upload your payment slip (screenshot or photo) below for verification.</p>
          <label className="mt-3 block">
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={handleSlipUpload}
              disabled={submittingSlip}
              className="text-sm"
            />
          </label>
          {slipError && <p className="mt-2 text-xs text-red-700">{slipError}</p>}
        </div>
      )}

      {reconciliation.paymentStatus === 'submitted' && (
        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
          <p className="font-semibold">📨 Payment slip received</p>
          <p className="mt-1">Our team will verify within 24 hours. You&apos;ll receive a confirmation email or SMS.</p>
        </div>
      )}

      {reconciliation.paymentStatus === 'verified' && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
          <p className="font-semibold">✅ Payment verified</p>
          <p className="mt-1">Your deposit is confirmed. We&apos;ll start production and send you updates via SMS/email.</p>
        </div>
      )}
    </section>
  );
}
