import Link from "next/link";
import type { ReactNode } from "react";

type PolicyDraftPageProps = {
  children: ReactNode;
  title: string;
};

export default function PolicyDraftPage({
  children,
  title,
}: PolicyDraftPageProps) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <Link href="/" className="text-sm font-semibold text-slate-700 hover:underline">
          Michael Jeffrey International Corporation
        </Link>

        <aside className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">DRAFT — OWNER REVIEW REQUIRED</p>
          <p className="mt-1">
            This draft is not approved for publication or Meta app submission.
            Confirm its accuracy and obtain any required legal review first.
          </p>
        </aside>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">{title}</h1>
        <div className="mt-6 space-y-5 text-base leading-7 text-slate-700">
          {children}
        </div>
        <p className="mt-10 border-t border-slate-200 pt-5 text-sm text-slate-500">
          Return to the{" "}
          <Link href="/#contact" className="font-medium underline">
            MJIC website contact section
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
