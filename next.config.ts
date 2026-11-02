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