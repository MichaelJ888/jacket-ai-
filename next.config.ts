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
};

export default nextConfig;