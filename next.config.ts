import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Eval result JSON is read from disk at build time by /evals.
  outputFileTracingIncludes: {
    '/evals': ['./evals/results/**/*'],
  },
};

export default nextConfig;
