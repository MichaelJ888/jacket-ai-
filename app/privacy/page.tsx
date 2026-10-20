import type { Metadata } from "next";
import PolicyDraftPage from "../_components/PolicyDraftPage";

export const metadata: Metadata = {
  title: "Privacy Policy Draft | MJIC",
  description: "Draft privacy policy for owner review.",
};

export default function PrivacyPolicyPage() {
  return (
    <PolicyDraftPage title="Privacy Policy">
      <p>
        <strong>What we collect:</strong> when you submit an inquiry or
        quotation request, we collect the name, company, contact details, and
        message you provide. We also use Google Analytics to understand general
        site traffic, such as pages viewed, general location, and device type.
      </p>
      <p>
        <strong>How we use it:</strong> to respond to your inquiry, prepare
        quotations, and process confirmed orders. The existing website notice
        states that MJIC does not sell or rent this information to third
        parties.
      </p>
      <p>
        <strong>Payment information:</strong> the existing website notice says
        card payments are processed by PayMongo and that bank or e-wallet
        transfers are confirmed manually from receipts sent to the sales team.
      </p>
      <p>
        <strong>Your rights:</strong> the existing website notice refers to
        access, correction, and deletion requests under the Philippine Data
        Privacy Act of 2012, through the contact options on the MJIC website.
      </p>
      <p>
        <strong>Contact:</strong> Michael Jeffrey International Corporation,
        BGC, Taguig City.
      </p>
      <p className="rounded-lg bg-slate-100 p-4 text-sm">
        <strong>Required owner review:</strong> this draft is based on the
        current website notice and does not yet describe the Messenger and
        automated-reply data flows, all service providers, data retention, or
        other app-specific processing. Verify and complete those details before
        submitting this URL to Meta.
      </p>
    </PolicyDraftPage>
  );
}
