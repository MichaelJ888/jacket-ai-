import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  async redirects() {
    return [
      {
        source: '/images/production%20tahian/:file',
        destination: '/images/production%20sewing%20area/:file',
        permanent: true,
      },
    ];
  },
  async headers() {
    // Vercel Edge caching for public/ assets. Hashed /_next/static files keep Next's own immutable
    // cache header (it cannot be overridden), so they are not listed here.
    const media = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
    const page = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
    const cache = (source: string, value: string) => ({ source, headers: [{ key: 'Cache-Control', value }] });
    return [
      // Heavy media: edge-cached 1 day; the weekly photo rotation stays fresh via stale-while-revalidate.
      cache('/images/:path*', media),
      cache('/videos/:path*', media),
      cache('/templates/:path*', media),
      // Homepage + root assets: edge-cached 5 min so editor/SEO updates propagate quickly.
      cache('/', page),
      cache('/index.html', page),
      cache('/mjic-client-journey.html', page),
      cache('/site-cms.js', page),
      cache('/site-look.js', page),
      cache('/live-ticker.js', page),
      cache('/image-library.json', page),
      cache('/robots.txt', page),
      cache('/sitemap.xml', page),
    ];
  },
  async rewrites() {
    // Serve the full homepage HTML at / so crawlers read the content and JSON-LD without running JS.
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;