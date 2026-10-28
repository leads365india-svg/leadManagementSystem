/** @type {import('next').NextConfig} */
const backendUrl = process.env.INTERNAL_BACKEND_URL || (process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/?$/, '') : 'http://localhost:5000')

const nextConfig = {
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  async rewrites() {
    return [
      {
        source: '/api/calls/:callId/recording',
        destination: `${backendUrl}/api/calls/:callId/recording`,
      },
      {
        source: '/api/mobile/v1/:path*',
        destination: `${backendUrl}/api/mobile/v1/:path*`,
      },
      {
        source: '/uploads/recordings/:tenantId/:fileName',
        destination: `${backendUrl}/uploads/recordings/:tenantId/:fileName`,
      },
    ]
  },
}

export default nextConfig

