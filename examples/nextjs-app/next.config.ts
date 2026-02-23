import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@pocket/core', '@pocket/next', '@pocket/react', '@pocket/storage-memory'],
};

export default nextConfig;
