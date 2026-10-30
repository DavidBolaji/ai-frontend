/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
  async redirects() {
    return ['/chat', '/roadmap'].map(source => ({ source, destination: '/knowledge', permanent: false }));
  },
  async rewrites() {
    const backendBaseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;

    if (!backendBaseUrl) {
      return [];
    }

    return [
      // WebSocket endpoint — must come before the catch-all
      {
        source: '/api/ws/:path*',
        destination: `${backendBaseUrl}/ws/:path*`,
      },
      {
        source: '/api/proxy/:path*',
        destination: `${backendBaseUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
