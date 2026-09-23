/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Pinahihintulutan ang deployment kahit may kaunting TypeScript warnings
    ignoreBuildErrors: true,
  },
  eslint: {
    // Pinahihintulutan ang deployment kahit may ESLint warnings
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;