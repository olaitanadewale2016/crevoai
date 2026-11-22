import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  compress: true,
  poweredByHeader: false,
  serverExternalPackages: ['mongoose', 'pdfkit', 'nodemailer', 'pusher', 'bcryptjs'],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      '@radix-ui/react-popover',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      'recharts',
      'clsx',
      'tailwind-merge',
    ],
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;
