import type { Metadata } from "next";
import Link from "next/link";
import PolicyDraftPage from "../_components/PolicyDraftPage";

export const metadata: Metadata = {
  title: "Data Deletion Instructions Draft | MJIC",
  description: "Draft instructions for requesting deletion of personal data.",
};

export default function DataDeletionPage() {
  return (
    <PolicyDraftPage title="Data Deletion Instructions">
      <p>
        You may ask Michael Jeffrey International Corporation (MJIC) to review
        a request to delete personal information associated with an inquiry or
        customer interaction.
      </p>
      <ol className="list-decimal space-y-3 pl-6">
        <li>
          Contact MJIC using the contact options in the{" "}
          <Link href="/#contact" className="font-medium underline">
            website Contact section
          </Link>
          .
        </li>
        <li>
          Use the subject line “Data Deletion Request” and identify the
          Facebook Page or contact channel involved, the approximate date, and
          the contact details needed to locate the record.
        </li>
        <li>
          Do not include passwords, full payment-card numbers, or other
          authentication credentials in the request.
        </li>
      </ol>
      <p>
        MJIC should verify the requester and explain what information can be
        deleted, what must be retained under applicable obligations, and
        whether copies held by Meta or other service providers require a
        separate request.
      </p>
      <p className="rounded-lg bg-slate-100 p-4 text-sm">
        <strong>Required owner review:</strong> confirm the contact channel,
        identity-verification process, deletion workflow, retention exceptions,
        and response timeframe. This draft does not promise that a request has
        been received, processed, or completed.
      </p>
    </PolicyDraftPage>
  );
}
