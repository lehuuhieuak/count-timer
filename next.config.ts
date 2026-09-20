import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
