/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
