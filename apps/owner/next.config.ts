import path from 'node:path';
import type { NextConfig } from 'next';

// The owner API lives in the NestJS app. In production Caddy sends /api/owner there directly;
// this rewrite does the same in development, so the session cookie stays on this site.
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  turbopack: { root: path.join(process.cwd(), '../..') },
  async rewrites() {
    return [{ source: '/api/owner/:path*', destination: `${apiUrl}/api/owner/:path*` }];
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

export default nextConfig;
