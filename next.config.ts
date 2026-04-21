import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/songbook',
  assetPrefix: '/songbook',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
