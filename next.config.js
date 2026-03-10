/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendBaseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;

    if (!backendBaseUrl) {
      return [];
    }

    return [
      {
        source: '/api/proxy/:path*',
        destination: `${backendBaseUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
