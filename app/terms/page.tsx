import type { Metadata } from "next";
import PolicyDraftPage from "../_components/PolicyDraftPage";

export const metadata: Metadata = {
  title: "Terms of Service Draft | MJIC",
  description: "Draft terms of service for owner review.",
};

export default function TermsOfServicePage() {
  return (
    <PolicyDraftPage title="Terms of Service">
      <p>
        <strong>Quotations:</strong> prices shown are estimates and are
        confirmed only upon a formal quotation issued by the sales team.
        Quotations are valid for 15 days from the date of issue.
      </p>
      <p>
        <strong>Orders and payment:</strong> a 50% down payment confirms a
        production slot. The remaining 50% balance is due cash-on-delivery upon
        receipt of finished goods, unless otherwise agreed in writing.
      </p>
      <p>
        <strong>Minimum order quantity:</strong> the company-wide minimum is
        20 pieces; some categories require a higher minimum as shown per
        product.
      </p>
      <p>
        <strong>Lead times:</strong> stated lead times are estimates and may
        change based on order volume, fabric availability, and design
        complexity.
      </p>
      <p>
        <strong>Promotional offers:</strong> free logo application applies to
        the first design per order; a free pre-production sample applies to
        confirmed orders of 100 pieces or more per design; and free delivery
        applies within Metro Manila only.
      </p>
      <p>
        <strong>Cancellations:</strong> a production slot secured by a down
        payment may not be refundable once cutting or embroidery has begun.
        Confirm cancellation terms with the sales team before paying a deposit.
      </p>
      <p className="rounded-lg bg-slate-100 p-4 text-sm">
        <strong>Required owner review:</strong> confirm these business terms
        remain current and decide whether additional terms are needed for
        Messenger conversations, automated replies, or use of the app before
        submitting this URL to Meta.
      </p>
    </PolicyDraftPage>
  );
}
