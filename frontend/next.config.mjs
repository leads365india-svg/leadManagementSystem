const rawApiUrl = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "")
const backendUrl = process.env.INTERNAL_BACKEND_URL
  ? process.env.INTERNAL_BACKEND_URL.trim().replace(/\/+$/, "")
  : (rawApiUrl ? rawApiUrl.replace(/\/api\/?$/, "") : "http://localhost:5000")

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
  webpack: (config, { dev, isServer }) => {
    if (!isServer) {
      config.output.chunkLoadTimeout = 300000
    }
    if (dev) {
      config.watchOptions = {
        poll: false,
        aggregateTimeout: 300,
        ignored: /node_modules|\.git|\.next/,
      }
    }
    return config
  },
  onDemandEntries: {
    maxInactiveAge: 120 * 1000,
    pagesBufferLength: 8,
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

