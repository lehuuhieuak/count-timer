import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
