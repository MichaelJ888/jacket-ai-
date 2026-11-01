import Link from 'next/link';

const TOOLS = [
  { href: '/admin/editor', title: 'Live Visual Site Editor', body: 'Click any heading, text or image on Home, Production, Capabilities and Advantages to edit it.', live: true },
  { href: '/admin/video-mockups', title: 'Video & picture mockups', body: 'Generate local campaign mockups for ads and social posts.', live: true },
  { href: '/admin', title: 'System dashboard', body: 'Prices, knowledge base, CRM, Facebook and Telegram recipients.', live: true },
  { href: '/admin/studio', title: 'Batch face-swap, 4K enhancer & logo overlay', body: 'Automated enhancement pipeline. Not connected yet; no AI processing runs from this page.', live: false },
];

export default function CeoAiStudioPage() {
  return (
    <main className="mx-auto max-w-5xl p-6 text-zinc-900">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">CEO AI Studio &amp; Enhancer</h1>
        <Link href="/admin" className="text-sm underline">← MJIC Admin</Link>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link key={tool.title} href={tool.href} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm hover:border-zinc-900">
            <h2 className="text-lg font-bold">{tool.title}</h2>
            <p className="mt-2 text-sm text-zinc-600">{tool.body}</p>
            {!tool.live && <span className="mt-3 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Coming soon</span>}
          </Link>
        ))}
      </section>
    </main>
  );
}
