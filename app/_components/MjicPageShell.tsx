import Link from "next/link";
import type { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/production-workflow", label: "Production Workflow" },
  { href: "/capabilities", label: "Capabilities & Advantages" },
];

export default function MjicPageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-[#0B1E3D]">
      <header className="sticky top-0 z-10 border-b border-[#0B1E3D]/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="font-bold tracking-widest">
            MJIC
          </Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-[#3C567F]">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-[#0B1E3D]">
                {link.label}
              </Link>
            ))}
            <Link href="/" className="hover:text-[#0B1E3D]">
              Back to Home
            </Link>
          </nav>
        </div>
      </header>

      <section className="bg-[#0B1E3D] px-4 py-14 text-white sm:py-20">
        <div className="mx-auto max-w-6xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#C9A03C]">
            {eyebrow}
          </p>
          <h1 className="font-bold text-3xl leading-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-base text-white/80">{intro}</p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:py-16">{children}</main>

      <footer className="border-t border-[#0B1E3D]/10 px-4 py-8 text-center text-xs text-[#3C567F]">
        Michael Jeffrey International Corporation (MJIC) · Customized jackets, uniforms and
        branded products
      </footer>
    </div>
  );
}
