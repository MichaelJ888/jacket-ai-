import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav
        aria-label="Admin navigation"
        className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-cyan-400/20 bg-zinc-950/95 px-4 py-2 text-sm shadow-lg backdrop-blur"
      >
        <Link
          href="/"
          className="rounded-lg border border-cyan-400/40 px-4 py-2 font-semibold text-cyan-100 transition hover:bg-cyan-400/10"
        >
          MJIC Website Landing Page
        </Link>
        <Link
          href="/admin"
          className="rounded-lg border border-fuchsia-400/40 px-4 py-2 font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/10"
        >
          Admin Dashboard
        </Link>
      </nav>
      {children}
    </>
  );
}
